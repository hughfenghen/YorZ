import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateProjectId } from '../global-config.js'
import {
  PROJECT_META_FILE_NAME,
  TELEMETRY_FILE_NAME,
  findProjectRoot,
  getTelemetry,
  normalizeUsage,
  resetTelemetry,
  resolveMetricsDir,
  resolveProjectMetricsDir,
  snapshotSpec,
  type TelemetryEnvelope,
} from '../telemetry/index.js'

let home: string
let projectRoot: string

function env(): NodeJS.ProcessEnv {
  return { YORZ_HOME: home }
}

function readLines(root: string): TelemetryEnvelope[] {
  const file = join(resolveProjectMetricsDir(root, env()), TELEMETRY_FILE_NAME)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as TelemetryEnvelope)
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
  it('honors YORZ_HOME and names the directory after the project id', () => {
    expect(resolveMetricsDir(env())).toBe(join(home, 'metrics'))
    expect(resolveProjectMetricsDir(projectRoot, env())).toBe(
      join(home, 'metrics', generateProjectId(projectRoot)),
    )
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
    const [line, ...rest] = readLines(projectRoot)
    expect(rest).toHaveLength(0)
    expect(line.v).toBe(1)
    expect(line.event).toBe('agent.turn')
    expect(line.projectId).toBe(generateProjectId(projectRoot))
    expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(line.sessionId).toBe('s1')
    expect(line.traceId).toBe('r1')
    expect(line.usage).toEqual({ inputTokens: 5 })
  })

  it('writes the id → path sidecar once', async () => {
    const t = getTelemetry(projectRoot, env())
    t.record('cmd.exec', { status: 'exited' })
    await t.flush()
    // the sidecar is written off the write path; give it a tick to land
    await new Promise((r) => setTimeout(r, 30))
    const meta = JSON.parse(
      readFileSync(join(resolveProjectMetricsDir(projectRoot, env()), PROJECT_META_FILE_NAME), 'utf8'),
    ) as { id: string; path: string }
    expect(meta).toMatchObject({ id: generateProjectId(projectRoot), path: projectRoot })
  })

  it('drops undefined payload values rather than writing nulls', async () => {
    const t = getTelemetry(projectRoot, env())
    t.record('git.op', { op: 'status', ok: true, exitCode: undefined })
    await t.flush()
    const [line] = readLines(projectRoot)
    expect('exitCode' in line).toBe(false)
    expect(line.ok).toBe(true)
  })

  it('writes nothing when YORZ_TELEMETRY is off', async () => {
    const t = getTelemetry(projectRoot, { ...env(), YORZ_TELEMETRY: 'off' })
    expect(t.enabled).toBe(false)
    t.record('agent.turn', { sessionId: 's1' })
    await t.flush()
    expect(readLines(projectRoot)).toHaveLength(0)
  })

  it('never throws on an unserializable payload', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const t = getTelemetry(projectRoot, env())
    expect(() => t.record('agent.turn', { cyclic })).not.toThrow()
    await t.flush()
    expect(readLines(projectRoot)).toHaveLength(0)
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
