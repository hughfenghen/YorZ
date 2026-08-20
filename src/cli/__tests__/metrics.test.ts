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

function line(event: string, payload: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    ts: '2026-08-19 10:00:00',
    event,
    projectId: generateProjectId(projectRoot),
    ...payload,
  })
}

function seed(...lines: string[]): void {
  const dir = join(home, 'metrics', generateProjectId(projectRoot))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'telemetry.jsonl'), `${lines.join('\n')}\n`)
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify({ id: generateProjectId(projectRoot), path: projectRoot }),
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
      line('git.op', { op: 'status', ok: true }),
    )
    const { exitCode, summary } = await runMetrics({ cwd: projectRoot, format: 'json' })
    expect(exitCode).toBe(0)
    expect(summary.eventCounts).toMatchObject({
      'agent.dispatch': 2,
      'agent.turn': 2,
      'git.op': 1,
    })
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
      line('agent.turn', { specId: 'old', usage: { costUsd: 1 } }).replace(
        '2026-08-19',
        '2026-08-01',
      ),
      line('agent.turn', { specId: 'new', usage: { costUsd: 2 } }),
      '{"v":1,"event":"agent.tur',
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

  it('renders a text report by default', async () => {
    seed(line('agent.turn', { specId: 'a', usage: { costUsd: 0.5, inputTokens: 3 } }))
    await runMetrics({ cwd: projectRoot, format: 'text' })
    const out = writes.join('')
    expect(out).toContain('per spec (by cost)')
    expect(out).toContain('$0.5000')
  })
})
