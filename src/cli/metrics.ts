import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { generateProjectId } from '../service/global-config.js'
import {
  findProjectRoot,
  parseTs,
  resolveProjectsIndexFile,
  resolveTelemetryFile,
  type ProjectsIndex,
} from '../service/telemetry/index.js'

export interface RunMetricsOptions {
  cwd: string
  format: 'text' | 'json'
  /** Project id (as recorded on each line) or an absolute project path. */
  project?: string
  /** Aggregate every project instead of just the current one. */
  all?: boolean
  /** Keep only events at or after this local `YYYY-MM-DD`. */
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
 * Read side of telemetry: aggregate the shared JSONL into the per-spec
 * cost / token / duration view the module was built to answer.
 */
export async function runMetrics(opts: RunMetricsOptions): Promise<RunMetricsResult> {
  const file = resolveTelemetryFile()
  if (!existsSync(file)) {
    process.stderr.write('no telemetry found — run a dispatch first\n')
    return { exitCode: 1, summary: emptySummary() }
  }
  const filter = resolveProjectFilter(opts)
  const summary = emptySummary()
  summary.files.push(file)
  await consumeFile(file, opts, filter, summary)
  if (summary.lines === 0) {
    process.stderr.write(
      filter
        ? `no telemetry for project ${filter} — pass --project <id|path> / --all\n`
        : 'no telemetry matched the given filters\n',
    )
    return { exitCode: 1, summary }
  }
  summary.projects = await projectLabels(summary.projects)
  summary.specs.sort((a, b) => b.costUsd - a.costUsd || b.turns - a.turns)
  if (opts.format === 'json') {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } else {
    process.stdout.write(renderText(summary))
  }
  return { exitCode: 0, summary }
}

/**
 * Which `projectId` to keep, or `null` for "every project".
 *
 * Projects are no longer separated by directory, so selection happens per line.
 * An absolute path is hashed exactly the way the service hashes it; anything
 * else is taken as an already-computed id.
 */
export function resolveProjectFilter(opts: RunMetricsOptions): string | null {
  if (opts.all) return null
  if (opts.project) {
    return isAbsolute(opts.project) ? generateProjectId(resolve(opts.project)) : opts.project
  }
  const root = findProjectRoot(opts.cwd)
  return root ? generateProjectId(root) : null
}

/** Turn collected ids into `id (path)` labels using the projects index. */
async function projectLabels(ids: string[]): Promise<string[]> {
  let index: ProjectsIndex = {}
  try {
    index = JSON.parse(await readFile(resolveProjectsIndexFile(), 'utf8')) as ProjectsIndex
  } catch {
    // no index — fall back to bare ids
  }
  return ids.map((id) => (index[id]?.path ? `${id} (${index[id].path})` : id))
}

/** Local midnight of a `YYYY-MM-DD` string, in epoch ms. */
function sinceMs(since: string | undefined): number | null {
  if (!since) return null
  const ms = Date.parse(`${since}T00:00:00`)
  return Number.isNaN(ms) ? null : ms
}

async function consumeFile(
  file: string,
  opts: RunMetricsOptions,
  filter: string | null,
  out: MetricsSummary,
) {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return
  }
  const from = sinceMs(opts.since)
  const seenProjects = new Set<string>()
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
    const projectId = typeof ev.projectId === 'string' ? ev.projectId : ''
    if (filter && projectId !== filter) continue
    const ts = parseTs(ev.ts)
    if (from !== null && (ts === null || ts < from)) continue
    if (projectId && !seenProjects.has(projectId)) {
      seenProjects.add(projectId)
      out.projects.push(projectId)
    }
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

