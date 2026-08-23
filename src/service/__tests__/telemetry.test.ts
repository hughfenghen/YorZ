import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateProjectId } from '../global-config.js'
import {
  PROJECTS_INDEX_FILE_NAME,
  TELEMETRY_FILE_NAME,
  findProjectRoot,
  getTelemetry,
  initTelemetryStore,
  normalizeUsage,
  resetTelemetry,
  resolveMetricsDir,
  resolveProjectsIndexFile,
  resolveTelemetryFile,
  snapshotSpec,
  type ProjectsIndex,
  type TelemetryEnvelope,
} from '../telemetry/index.js'

let home: string
let projectRoot: string

function env(): NodeJS.ProcessEnv {
  return { YORZ_HOME: home }
}

/** Every project shares one file; `projectId` is what separates them. */
function readLines(projectId?: string): TelemetryEnvelope[] {
  const file = resolveTelemetryFile(env())
  if (!existsSync(file)) return []
  const all = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TelemetryEnvelope)
  return projectId ? all.filter((l) => l.projectId === projectId) : all
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'yorz-metrics-home-'))
  projectRoot = mkdtempSync(join(tmpdir(), 'yorz-metrics-proj-'))
  resetTelemetry()
})

afterEach(() => {
  resetTelemetry()
  rmSync(home, { recursive: true, force: true })
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('telemetry paths', () => {
  it('honors YORZ_HOME and keeps every project in one file', () => {
    expect(resolveMetricsDir(env())).toBe(join(home, 'metrics'))
    expect(resolveTelemetryFile(env())).toBe(join(home, 'metrics', TELEMETRY_FILE_NAME))
    expect(resolveProjectsIndexFile(env())).toBe(join(home, 'metrics', PROJECTS_INDEX_FILE_NAME))
  })

  it('walks up to the nearest .yorz directory', () => {
    const nested = join(projectRoot, 'src', 'deep')
    mkdirSync(join(projectRoot, '.yorz'), { recursive: true })
    mkdirSync(nested, { recursive: true })
    expect(findProjectRoot(nested)).toBe(projectRoot)
  })
})

describe('usage normalization', () => {
  it('maps the claude Messages usage shape', () => {
    expect(
      normalizeUsage('claude', {
        input_tokens: 12,
        output_tokens: 34,
        cache_read_input_tokens: 56,
        cache_creation_input_tokens: 78,
      }),
    ).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      cacheReadTokens: 56,
      cacheCreateTokens: 78,
    })
  })

  it('splits the cached portion out of codex input tokens', () => {
    expect(
      normalizeUsage('codex', {
        input_tokens: 100,
        cached_input_tokens: 40,
        output_tokens: 7,
        reasoning_output_tokens: 3,
      }),
    ).toEqual({
      inputTokens: 60,
      cacheReadTokens: 40,
      outputTokens: 7,
      reasoningTokens: 3,
    })
  })

  it('maps the opencode nested cache shape', () => {
    expect(
      normalizeUsage('opencode', {
        input: 5,
        output: 6,
        reasoning: 1,
        cache: { read: 9, write: 2 },
      }),
    ).toEqual({
      inputTokens: 5,
      outputTokens: 6,
      reasoningTokens: 1,
      cacheReadTokens: 9,
      cacheCreateTokens: 2,
    })
  })

  it('keeps unreported fields undefined instead of zero', () => {
    const usage = normalizeUsage('claude', { input_tokens: 3 })
    expect(usage).toEqual({ inputTokens: 3 })
    expect('cacheReadTokens' in (usage ?? {})).toBe(false)
  })

  it('returns undefined for shapes it cannot read', () => {
    expect(normalizeUsage('claude', null)).toBeUndefined()
    expect(normalizeUsage('claude', { nothing: 'useful' })).toBeUndefined()
  })
})

describe('recorder', () => {
  it('writes one JSONL line per event with a full envelope', async () => {
    const t = getTelemetry(projectRoot, env())
    t.record('agent.turn', { sessionId: 's1', traceId: 'r1', usage: { inputTokens: 5 } })
    await t.flush()
    const [line, ...rest] = readLines()
    expect(rest).toHaveLength(0)
    expect(line.v).toBe(2)
    expect(line.event).toBe('agent.turn')
    expect(line.projectId).toBe(generateProjectId(projectRoot))
    expect(typeof line.ts).toBe('number')
    expect(line.ts).toBeGreaterThan(Date.parse('2020-01-01'))
    expect(line.sessionId).toBe('s1')
    expect(line.traceId).toBe('r1')
    expect(line.usage).toEqual({ inputTokens: 5 })
  })

  it('indexes the project id → path mapping once', async () => {
    const t = getTelemetry(projectRoot, env())
    t.record('cmd.exec', { status: 'exited' })
    await t.flush()
    const index = JSON.parse(
      readFileSync(resolveProjectsIndexFile(env()), 'utf8'),
    ) as ProjectsIndex
    const entry = index[generateProjectId(projectRoot)]
    expect(entry?.path).toBe(projectRoot)
    expect(typeof entry?.firstSeenAt).toBe('number')
  })

  it('merges two projects into one file, told apart by projectId', async () => {
    const other = mkdtempSync(join(tmpdir(), 'yorz-metrics-proj2-'))
    try {
      const a = getTelemetry(projectRoot, env())
      const b = getTelemetry(other, env())
      a.record('agent.turn', { sessionId: 'a' })
      b.record('agent.turn', { sessionId: 'b' })
      a.record('cmd.exec', { status: 'exited' })
      await Promise.all([a.flush(), b.flush()])
      expect(readLines()).toHaveLength(3)
      expect(readLines(generateProjectId(projectRoot))).toHaveLength(2)
      expect(readLines(generateProjectId(other))).toHaveLength(1)
      const index = JSON.parse(
        readFileSync(resolveProjectsIndexFile(env()), 'utf8'),
      ) as ProjectsIndex
      expect(Object.keys(index)).toHaveLength(2)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('drops undefined payload values rather than writing nulls', async () => {
    const t = getTelemetry(projectRoot, env())
    t.record('cmd.exec', { status: 'exited', ok: true, exitCode: undefined })
    await t.flush()
    const [line] = readLines()
    expect('exitCode' in line).toBe(false)
    expect(line.ok).toBe(true)
  })

  it('writes nothing when YORZ_TELEMETRY is off', async () => {
    const t = getTelemetry(projectRoot, { ...env(), YORZ_TELEMETRY: 'off' })
    expect(t.enabled).toBe(false)
    t.record('agent.turn', { sessionId: 's1' })
    await t.flush()
    expect(readLines()).toHaveLength(0)
  })

  it('never throws on an unserializable payload', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const t = getTelemetry(projectRoot, env())
    expect(() => t.record('agent.turn', { cyclic })).not.toThrow()
    await t.flush()
    expect(readLines()).toHaveLength(0)
  })

  it('returns the same recorder for the same root', () => {
    expect(getTelemetry(projectRoot, env())).toBe(getTelemetry(`${projectRoot}/`, env()))
  })
})

describe('spec snapshot', () => {
  it('counts single-level task checkboxes', () => {
    const snapshot = snapshotSpec({
      id: 'x',
      frontmatter: { stage: 'execute', last_action: '', updated_at: '', summary: '' },
      body: '## 6. 任务清单\n\n- [x] done one\n- [X] done two\n- [ ] pending\n',
      mtime: 0,
    })
    expect(snapshot).toMatchObject({ stage: 'execute', tasksTotal: 3, tasksDone: 2 })
    expect(snapshot?.specBytes).toBeGreaterThan(0)
  })

  it('returns null when the spec is gone', () => {
    expect(snapshotSpec(null)).toBeNull()
  })
})

describe('telemetry store housekeeping', () => {
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000
  const now = Date.parse('2026-08-23T12:00:00Z')

  function writeUnified(lines: unknown[]): void {
    mkdirSync(resolveMetricsDir(env()), { recursive: true })
    writeFileSync(resolveTelemetryFile(env()), lines.map((l) => `${JSON.stringify(l)}\n`).join(''))
  }

  it('drops expired lines and keeps the file sorted by ts', async () => {
    const fresh = now - 1000
    const older = now - 2000
    writeUnified([
      { v: 2, ts: fresh, event: 'agent.turn', projectId: 'p1' },
      { v: 2, ts: now - 2 * YEAR_MS, event: 'agent.turn', projectId: 'p1' },
      { v: 2, ts: older, event: 'cmd.exec', projectId: 'p2' },
    ])
    const stats = await initTelemetryStore({ env: env(), now })
    expect(stats).toMatchObject({ kept: 2, dropped: 1, migrated: 0 })
    expect(readLines().map((l) => l.ts)).toEqual([older, fresh])
  })

  it('drops unparseable lines instead of counting them as kept', async () => {
    mkdirSync(resolveMetricsDir(env()), { recursive: true })
    writeFileSync(
      resolveTelemetryFile(env()),
      `${JSON.stringify({ v: 2, ts: now, event: 'agent.turn', projectId: 'p1' })}\n{"broken":\n`,
    )
    const stats = await initTelemetryStore({ env: env(), now })
    expect(stats).toMatchObject({ kept: 1, dropped: 1 })
  })

  it('migrates legacy per-project directories and retires dead event kinds', async () => {
    const projectId = generateProjectId(projectRoot)
    const legacyDir = join(resolveMetricsDir(env()), projectId)
    mkdirSync(legacyDir, { recursive: true })
    const stamp = (ms: number): string => {
      const d = new Date(ms)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }
    const keptAt = now - 60_000
    writeFileSync(
      join(legacyDir, TELEMETRY_FILE_NAME),
      [
        { v: 1, ts: stamp(keptAt), event: 'agent.turn', projectId, usage: { inputTokens: 5 } },
        { v: 1, ts: stamp(now - 1000), event: 'git.op', projectId, op: 'status' },
        { v: 1, ts: stamp(now - 2 * YEAR_MS), event: 'agent.turn', projectId },
      ]
        .map((l) => `${JSON.stringify(l)}\n`)
        .join(''),
    )
    writeFileSync(
      `${join(legacyDir, TELEMETRY_FILE_NAME)}.1`,
      `${JSON.stringify({ v: 1, ts: stamp(now - 120_000), event: 'spec.change', projectId })}\n`,
    )
    writeFileSync(
      join(legacyDir, 'project.json'),
      JSON.stringify({ id: projectId, path: projectRoot, firstSeenAt: stamp(keptAt) }),
    )

    const stats = await initTelemetryStore({ env: env(), now })

    expect(existsSync(legacyDir)).toBe(false)
    expect(stats).toMatchObject({ migrated: 1, kept: 1, legacyDirs: 1 })
    const [line, ...rest] = readLines()
    expect(rest).toHaveLength(0)
    expect(line).toMatchObject({ v: 2, ts: keptAt, event: 'agent.turn', projectId })
    const index = JSON.parse(readFileSync(resolveProjectsIndexFile(env()), 'utf8')) as ProjectsIndex
    expect(index[projectId]?.path).toBe(projectRoot)
  })

  it('is a no-op when nothing has ever been recorded', async () => {
    const stats = await initTelemetryStore({ env: env(), now })
    expect(stats).toMatchObject({ kept: 0, dropped: 0, migrated: 0 })
    expect(existsSync(resolveTelemetryFile(env()))).toBe(false)
  })
})
