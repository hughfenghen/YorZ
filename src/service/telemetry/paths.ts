import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveGlobalConfigDir } from '../global-config.js'

/** Telemetry lives next to `logs/` under the global config dir, never in the project. */
export const METRICS_DIR_NAME = 'metrics'
/** Every project appends to this one file; the in-line `projectId` separates them. */
export const TELEMETRY_FILE_NAME = 'telemetry.jsonl'
/** `projectId` → `{ path, firstSeenAt }`, so short ids stay resolvable. */
export const PROJECTS_INDEX_FILE_NAME = 'projects.json'

/**
 * How long a recorded event is kept. Enforced by the startup prune, not by
 * size-based rotation: rotation would evict a busy project's neighbours and
 * could never express "one year" in the first place.
 */
export const TELEMETRY_RETENTION_DAYS = 365
export const TELEMETRY_RETENTION_MS = TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000

/**
 * Sink caps that switch rotation off: the size branch of `RotatingFileSink`
 * can never trigger, so the file only ever shrinks at startup.
 */
export const TELEMETRY_MAX_BYTES = Number.POSITIVE_INFINITY
export const TELEMETRY_MAX_ARCHIVES = 0

/** `<globalConfigDir>/metrics` — honours `YORZ_HOME` / `XDG_CONFIG_HOME`. */
export function resolveMetricsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveGlobalConfigDir(env), METRICS_DIR_NAME)
}

/** `<globalConfigDir>/metrics/telemetry.jsonl` — the single data file. */
export function resolveTelemetryFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveMetricsDir(env), TELEMETRY_FILE_NAME)
}

/** `<globalConfigDir>/metrics/projects.json` — the id → path index. */
export function resolveProjectsIndexFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveMetricsDir(env), PROJECTS_INDEX_FILE_NAME)
}

/**
 * Walk up from `startDir` to the nearest directory containing `.yorz`.
 *
 * The service always knows its project root; CLI commands only get a `--cwd`
 * that may point anywhere inside the project, so they need this to attribute
 * their events to the same id the service uses.
 */
export function findProjectRoot(startDir: string): string | null {
  let dir = resolve(startDir)
  for (;;) {
    if (existsSync(join(dir, '.yorz'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
