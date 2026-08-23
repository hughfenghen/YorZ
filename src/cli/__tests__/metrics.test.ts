import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMetrics } from '../metrics.js'
import { generateProjectId } from '../../service/global-config.js'

let home: string
let projectRoot: string
let savedHome: string | undefined
let writes: string[]

const TS = Date.parse('2026-08-19T10:00:00')

function line(
  event: string,
  payload: Record<string, unknown>,
  opts: { ts?: number; projectId?: string } = {},
): string {
  return JSON.stringify({
    v: 2,
    ts: opts.ts ?? TS,
    event,
    projectId: opts.projectId ?? generateProjectId(projectRoot),
    ...payload,
  })
}

/** Every project shares one file now; the index maps ids back to paths. */
function seed(...lines: string[]): void {
  const dir = join(home, 'metrics')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'telemetry.jsonl'), `${lines.join('\n')}\n`)
  writeFileSync(
    join(dir, 'projects.json'),
    JSON.stringify({ [generateProjectId(projectRoot)]: { path: projectRoot, firstSeenAt: TS } }),
  )
}

beforeEach(() => {
  savedHome = process.env.YORZ_HOME
  home = mkdtempSync(join(tmpdir(), 'yorz-metrics-cli-home-'))
  projectRoot = mkdtempSync(join(tmpdir(), 'yorz-metrics-cli-proj-'))
  mkdirSync(join(projectRoot, '.yorz'), { recursive: true })
  process.env.YORZ_HOME = home
  writes = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
  if (savedHome === undefined) delete process.env.YORZ_HOME
  else process.env.YORZ_HOME = savedHome
  rmSync(home, { recursive: true, force: true })
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('yorz metrics', () => {
  it('aggregates tokens and cost per spec', async () => {
    seed(
      line('agent.dispatch', { phase: 'start', specId: 'a', traceId: 'r1' }),
      line('agent.dispatch', { phase: 'end', specId: 'a', traceId: 'r1', ok: true, durMs: 100 }),
      line('agent.turn', {
        specId: 'a',
        traceId: 'r1',
        durMs: 90,
        usage: { inputTokens: 10, cacheReadTokens: 100, outputTokens: 5, costUsd: 0.25 },
      }),
      line('agent.turn', {
        specId: 'b',
        traceId: 'r2',
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.01 },
      }),
      line('agent.compact', { specId: 'a', compactTrigger: 'auto' }),
      line('cmd.exec', { status: 'exited', exitCode: 0 }),
    )
    const { exitCode, summary } = await runMetrics({ cwd: projectRoot, format: 'json' })
    expect(exitCode).toBe(0)
    expect(summary.eventCounts).toMatchObject({
      'agent.dispatch': 2,
      'agent.turn': 2,
      'cmd.exec': 1,
    })
    expect(summary.projects).toEqual([`${generateProjectId(projectRoot)} (${projectRoot})`])
    // one dispatch, counted from its `end` line only — not twice
    expect(summary.totals.dispatches).toBe(1)
    expect(summary.totals.costUsd).toBeCloseTo(0.26, 6)
    expect(summary.totals.cacheReadTokens).toBe(100)
    // sorted by cost, so spec `a` leads
    expect(summary.specs.map((s) => s.specId)).toEqual(['a', 'b'])
    expect(summary.specs[0]).toMatchObject({ dispatches: 1, turns: 1, compactions: 1 })
  })

  it('filters by --since and survives a truncated trailing line', async () => {
    seed(
      line('agent.turn', { specId: 'old', usage: { costUsd: 1 } }, { ts: Date.parse('2026-08-01T10:00:00') }),
      line('agent.turn', { specId: 'new', usage: { costUsd: 2 } }),
      '{"v":2,"event":"agent.tur',
    )
    const { summary } = await runMetrics({ cwd: projectRoot, format: 'json', since: '2026-08-19' })
    expect(summary.specs.map((s) => s.specId)).toEqual(['new'])
    expect(summary.skipped).toBe(1)
  })

  it('exits non-zero with a hint when the project has no telemetry', async () => {
    const { exitCode, summary } = await runMetrics({ cwd: projectRoot, format: 'json' })
    expect(exitCode).toBe(1)
    expect(summary.lines).toBe(0)
  })

  it('keeps other projects out of the default view but counts them under --all', async () => {
    seed(
      line('agent.turn', { specId: 'mine', usage: { costUsd: 0.5 } }),
      line('agent.turn', { specId: 'theirs', usage: { costUsd: 4 } }, { projectId: 'other-abc123' }),
    )
    const mine = await runMetrics({ cwd: projectRoot, format: 'json' })
    expect(mine.summary.specs.map((s) => s.specId)).toEqual(['mine'])

    const all = await runMetrics({ cwd: projectRoot, format: 'json', all: true })
    expect(all.summary.specs.map((s) => s.specId)).toEqual(['theirs', 'mine'])
    expect(all.summary.projects).toContain('other-abc123')

    const byId = await runMetrics({ cwd: projectRoot, format: 'json', project: 'other-abc123' })
    expect(byId.summary.specs.map((s) => s.specId)).toEqual(['theirs'])

    const byPath = await runMetrics({ cwd: projectRoot, format: 'json', project: projectRoot })
    expect(byPath.summary.specs.map((s) => s.specId)).toEqual(['mine'])
  })

  it('renders a text report by default', async () => {
    seed(line('agent.turn', { specId: 'a', usage: { costUsd: 0.5, inputTokens: 3 } }))
    await runMetrics({ cwd: projectRoot, format: 'text' })
    const out = writes.join('')
    expect(out).toContain('per spec (by cost)')
    expect(out).toContain('$0.5000')
  })
})
