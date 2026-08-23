import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  TELEMETRY_FILE_NAME,
  TELEMETRY_RETENTION_MS,
  resolveMetricsDir,
  resolveProjectsIndexFile,
  resolveTelemetryFile,
} from './paths.js'
import {
  TELEMETRY_SCHEMA_VERSION,
  type ProjectsIndex,
  type TelemetryEnvelope,
} from './types.js'

/** Events removed in schema v2 — dropped on sight, in old files too. */
const RETIRED_EVENTS = new Set(['git.op', 'spec.change'])

export interface InitTelemetryStoreOptions {
  env?: NodeJS.ProcessEnv
  /** Epoch ms treated as "now" (tests). */
  now?: number
  /** Retention window in ms; defaults to one year. */
  retentionMs?: number
}

export interface TelemetryStoreStats {
  /** Lines pulled in from the pre-v2 per-project directories. */
  migrated: number
  /** Lines surviving in the unified file. */
  kept: number
  /** Lines dropped: expired, retired event kinds, or unparseable. */
  dropped: number
  /** Legacy per-project directories removed. */
  legacyDirs: number
}

/**
 * Bring the metrics directory to the current layout and enforce retention.
 *
 * Called once at service startup, before anything can record: it rewrites the
 * shared file, which is only safe while no sink holds a cached size for it.
 * Every failure is contained — telemetry housekeeping must never keep the
 * service from starting.
 */
export async function initTelemetryStore(
  opts: InitTelemetryStoreOptions = {},
): Promise<TelemetryStoreStats> {
  const env = opts.env ?? process.env
  const now = opts.now ?? Date.now()
  const cutoff = now - (opts.retentionMs ?? TELEMETRY_RETENTION_MS)
  const stats: TelemetryStoreStats = { migrated: 0, kept: 0, dropped: 0, legacyDirs: 0 }

  const dir = resolveMetricsDir(env)
  if (!existsSync(dir)) return stats

  const rows: TelemetryEnvelope[] = []
  collect(await readLines(resolveTelemetryFile(env)), cutoff, rows, stats)
  const migratedBefore = rows.length
  await migrateLegacyDirs(dir, env, cutoff, rows, stats)
  stats.migrated = rows.length - migratedBefore

  rows.sort((a, b) => a.ts - b.ts)
  stats.kept = rows.length
  // Nothing on disk and nothing migrated: don't create an empty file.
  if (rows.length === 0 && stats.dropped === 0) return stats
  try {
    await writeAtomic(resolveTelemetryFile(env), rows.map((r) => `${JSON.stringify(r)}\n`).join(''))
  } catch {
    // a failed rewrite leaves the previous file untouched — acceptable
  }
  return stats
}

/**
 * Fold the pre-v2 `metrics/<projectId>/` directories into the shared file.
 *
 * Their lines already carry a `projectId` (it was recorded redundantly for
 * exactly this reason), so merging is lossless; only the string `ts` needs
 * converting. The directory is removed once its content has been absorbed.
 */
async function migrateLegacyDirs(
  metricsDir: string,
  env: NodeJS.ProcessEnv,
  cutoff: number,
  rows: TelemetryEnvelope[],
  stats: TelemetryStoreStats,
): Promise<void> {
  let entries: string[]
  try {
    entries = (await readdir(metricsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return
  }
  if (entries.length === 0) return

  const index = await readIndex(env)
  for (const projectId of entries) {
    const legacyDir = join(metricsDir, projectId)
    for (const file of await legacyFiles(legacyDir)) {
      collect(await readLines(file), cutoff, rows, stats, projectId)
    }
    const meta = await readLegacyMeta(legacyDir)
    if (meta && !index[projectId]) {
      index[projectId] = { path: meta.path, firstSeenAt: meta.firstSeenAt }
    }
    try {
      await rm(legacyDir, { recursive: true, force: true })
      stats.legacyDirs += 1
    } catch {
      // leave it in place; the next startup will retry
    }
  }
  await writeIndex(env, index)
}

/** The legacy layout's current file plus its rotated `.N` archives. */
async function legacyFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((name) => name === TELEMETRY_FILE_NAME || name.startsWith(`${TELEMETRY_FILE_NAME}.`))
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

async function readLegacyMeta(dir: string): Promise<{ path: string; firstSeenAt: number } | null> {
  try {
    const raw = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')) as {
      path?: string
      firstSeenAt?: string | number
    }
    if (!raw.path) return null
    return { path: raw.path, firstSeenAt: parseTs(raw.firstSeenAt) ?? 0 }
  } catch {
    return null
  }
}

/** Parse, filter and normalise raw JSONL lines into the accumulator. */
function collect(
  lines: string[],
  cutoff: number,
  out: TelemetryEnvelope[],
  stats: TelemetryStoreStats,
  fallbackProjectId?: string,
): void {
  for (const line of lines) {
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(line) as Record<string, unknown>
    } catch {
      stats.dropped += 1
      continue
    }
    const ts = parseTs(ev.ts)
    const event = typeof ev.event === 'string' ? ev.event : ''
    const projectId = typeof ev.projectId === 'string' ? ev.projectId : fallbackProjectId
    if (ts === null || ts < cutoff || !event || !projectId || RETIRED_EVENTS.has(event)) {
      stats.dropped += 1
      continue
    }
    out.push({ ...ev, v: TELEMETRY_SCHEMA_VERSION, ts, event, projectId })
  }
}

/** Accept both the v2 epoch number and the v1 local `YYYY-MM-DD HH:mm:ss`. */
export function parseTs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const ms = Date.parse(value.includes('T') ? value : value.replace(' ', 'T'))
  return Number.isNaN(ms) ? null : ms
}

async function readLines(file: string): Promise<string[]> {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter((l) => l.trim())
  } catch {
    return []
  }
}

async function readIndex(env: NodeJS.ProcessEnv): Promise<ProjectsIndex> {
  try {
    return JSON.parse(await readFile(resolveProjectsIndexFile(env), 'utf8')) as ProjectsIndex
  } catch {
    return {}
  }
}

async function writeIndex(env: NodeJS.ProcessEnv, index: ProjectsIndex): Promise<void> {
  if (Object.keys(index).length === 0) return
  try {
    await writeFile(resolveProjectsIndexFile(env), `${JSON.stringify(index, null, 2)}\n`)
  } catch {
    // best-effort
  }
}

/** Write via a temp file so a crash mid-rewrite cannot truncate the history. */
async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp`
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}
