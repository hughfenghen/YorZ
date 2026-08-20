import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import {
  PROJECT_META_FILE_NAME,
  TELEMETRY_FILE_NAME,
  findProjectRoot,
  resolveMetricsDir,
  resolveProjectMetricsDir,
} from '../service/telemetry/index.js'

export interface RunMetricsOptions {
  cwd: string
  format: 'text' | 'json'
  /** Project id (directory name under `metrics/`) or an absolute project path. */
  project?: string
  /** Aggregate every project instead of just the current one. */
  all?: boolean
  /** Keep only events whose `ts` is on or after this local `YYYY-MM-DD`. */
  since?: string
}

export interface SpecAggregate {
  specId: string
  dispatches: number
  turns: number
  compactions: number
  inputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  outputTokens: number
  costUsd: number
  agentDurMs: number
  failures: number
  stages: string[]
}

export interface MetricsSummary {
  projects: string[]
  files: string[]
  lines: number
  skipped: number
  eventCounts: Record<string, number>
  totals: Omit<SpecAggregate, 'specId' | 'stages'>
  specs: SpecAggregate[]
}

export interface RunMetricsResult {
  exitCode: number
  summary: MetricsSummary
}

const UNATTRIBUTED = '(no spec)'

/**
 * Read side of the telemetry files: aggregate raw JSONL into the per-spec
 * cost / token / duration view the spec was built to answer.
 */
export async function runMetrics(opts: RunMetricsOptions): Promise<RunMetricsResult> {
  const dirs = await resolveTargetDirs(opts)
  if (dirs.length === 0) {
    process.stderr.write(
      'no telemetry found — run a dispatch first, or pass --project <id|path> / --all\n',
    )
    return { exitCode: 1, summary: emptySummary() }
  }
  const summary = emptySummary()
  for (const dir of dirs) {
    summary.projects.push(await projectLabel(dir))
    for (const file of await telemetryFiles(dir)) {
      summary.files.push(file)
      await consumeFile(file, opts.since, summary)
    }
  }
  summary.specs.sort((a, b) => b.costUsd - a.costUsd || b.turns - a.turns)
  if (opts.format === 'json') {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } else {
    process.stdout.write(renderText(summary))
  }
  return { exitCode: 0, summary }
}

async function resolveTargetDirs(opts: RunMetricsOptions): Promise<string[]> {
  const metricsDir = resolveMetricsDir()
  if (opts.all) {
    if (!existsSync(metricsDir)) return []
    const entries = await readdir(metricsDir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => join(metricsDir, e.name))
  }
  if (opts.project) {
    // An absolute path is hashed the same way the service does; anything else
    // is taken as an already-computed project id (the directory name).
    const dir = isAbsolute(opts.project)
      ? resolveProjectMetricsDir(opts.project)
      : join(metricsDir, opts.project)
    return existsSync(dir) ? [dir] : []
  }
  const root = findProjectRoot(opts.cwd)
  if (!root) return []
  const dir = resolveProjectMetricsDir(root)
  return existsSync(dir) ? [dir] : []
}

/** Current file plus its rotated archives, oldest first. */
async function telemetryFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir)
  const archives = entries
    .filter((name) => name.startsWith(`${TELEMETRY_FILE_NAME}.`))
    .sort((a, b) => Number(b.split('.').pop()) - Number(a.split('.').pop()))
    .map((name) => join(dir, name))
  const current = join(dir, TELEMETRY_FILE_NAME)
  return existsSync(current) ? [...archives, current] : archives
}

async function projectLabel(dir: string): Promise<string> {
  try {
    const raw = await readFile(join(dir, PROJECT_META_FILE_NAME), 'utf8')
    const meta = JSON.parse(raw) as { id?: string; path?: string }
    return meta.path ? `${meta.id ?? '?'} (${meta.path})` : (meta.id ?? dir)
  } catch {
    return dir
  }
}

async function consumeFile(file: string, since: string | undefined, out: MetricsSummary) {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(line) as Record<string, unknown>
    } catch {
      // A partially flushed final line is normal on a live file; count it so
      // "everything was read" is never silently implied.
      out.skipped += 1
      continue
    }
    const ts = typeof ev.ts === 'string' ? ev.ts : ''
    if (since && ts.slice(0, 10) < since) continue
    out.lines += 1
    const event = typeof ev.event === 'string' ? ev.event : 'unknown'
    out.eventCounts[event] = (out.eventCounts[event] ?? 0) + 1
    applyEvent(ev, event, out)
  }
}

function applyEvent(ev: Record<string, unknown>, event: string, out: MetricsSummary) {
  if (!event.startsWith('agent.')) return
  const bucket = bucketFor(out, typeof ev.specId === 'string' ? ev.specId : UNATTRIBUTED)
  if (event === 'agent.dispatch') {
    // `start` and `end` are two lines for one dispatch — count the end only.
    if (ev.phase !== 'end') return
    bucket.dispatches += 1
    out.totals.dispatches += 1
    if (ev.ok === false) {
      bucket.failures += 1
      out.totals.failures += 1
    }
    return
  }
  if (event === 'agent.compact') {
    bucket.compactions += 1
    out.totals.compactions += 1
    return
  }
  if (event !== 'agent.turn') return
  bucket.turns += 1
  out.totals.turns += 1
  const durMs = num(ev.durMs)
  bucket.agentDurMs += durMs
  out.totals.agentDurMs += durMs
  const usage = (ev.usage ?? {}) as Record<string, unknown>
  for (const key of [
    'inputTokens',
    'cacheReadTokens',
    'cacheCreateTokens',
    'outputTokens',
  ] as const) {
    bucket[key] += num(usage[key])
    out.totals[key] += num(usage[key])
  }
  bucket.costUsd += num(usage.costUsd)
  out.totals.costUsd += num(usage.costUsd)
}

function bucketFor(out: MetricsSummary, specId: string): SpecAggregate {
  let bucket = out.specs.find((s) => s.specId === specId)
  if (!bucket) {
    bucket = {
      specId,
      dispatches: 0,
      turns: 0,
      compactions: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      agentDurMs: 0,
      failures: 0,
      stages: [],
    }
    out.specs.push(bucket)
  }
  return bucket
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function emptySummary(): MetricsSummary {
  return {
    projects: [],
    files: [],
    lines: 0,
    skipped: 0,
    eventCounts: {},
    totals: {
      dispatches: 0,
      turns: 0,
      compactions: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      agentDurMs: 0,
      failures: 0,
    },
    specs: [],
  }
}

const SPEC_ROW_LIMIT = 20

function renderText(s: MetricsSummary): string {
  const lines: string[] = []
  lines.push(`projects: ${s.projects.join(', ') || '(none)'}`)
  lines.push(`events:   ${s.lines}${s.skipped ? ` (${s.skipped} unparseable line(s))` : ''}`)
  const kinds = Object.entries(s.eventCounts).sort((a, b) => b[1] - a[1])
  if (kinds.length) {
    lines.push(`by kind:  ${kinds.map(([k, n]) => `${k}=${n}`).join('  ')}`)
  }
  const t = s.totals
  lines.push('')
  lines.push(
    `total: ${t.dispatches} dispatch(es), ${t.turns} turn(s), ${t.failures} failure(s), ${t.compactions} compaction(s)`,
  )
  lines.push(
    `tokens: in=${t.inputTokens} cacheRead=${t.cacheReadTokens} cacheWrite=${t.cacheCreateTokens} out=${t.outputTokens}`,
  )
  lines.push(`cost: $${t.costUsd.toFixed(4)}   agent time: ${(t.agentDurMs / 1000).toFixed(1)}s`)
  if (s.specs.length) {
    lines.push('')
    lines.push('per spec (by cost):')
    for (const spec of s.specs.slice(0, SPEC_ROW_LIMIT)) {
      lines.push(
        `  ${spec.specId.padEnd(40)} $${spec.costUsd.toFixed(4).padStart(9)}  ` +
          `${String(spec.dispatches).padStart(3)} disp  ${String(spec.turns).padStart(3)} turn  ` +
          `in=${spec.inputTokens} cacheRead=${spec.cacheReadTokens} out=${spec.outputTokens}`,
      )
    }
    if (s.specs.length > SPEC_ROW_LIMIT) {
      lines.push(`  … ${s.specs.length - SPEC_ROW_LIMIT} more spec(s) not shown (use --format json)`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Exported for tests: resolve which metrics directories a run would read. */
export { resolveTargetDirs as resolveMetricsTargets }
