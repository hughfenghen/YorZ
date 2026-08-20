import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { generateProjectId, resolveGlobalConfigDir } from '../global-config.js'

/** Telemetry lives next to `logs/` under the global config dir, never in the project. */
export const METRICS_DIR_NAME = 'metrics'
export const TELEMETRY_FILE_NAME = 'telemetry.jsonl'
export const PROJECT_META_FILE_NAME = 'project.json'

/** Single log file size cap: 5 MiB, matching `logger.ts`. */
export const DEFAULT_TELEMETRY_MAX_BYTES = 5 * 1024 * 1024
/** Keep two archives; disk peak per project ≈ 15 MiB. */
export const DEFAULT_TELEMETRY_MAX_ARCHIVES = 2

/** `<globalConfigDir>/metrics` — honours `YORZ_HOME` / `XDG_CONFIG_HOME`. */
export function resolveMetricsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveGlobalConfigDir(env), METRICS_DIR_NAME)
}

/**
 * `<globalConfigDir>/metrics/<projectId>`.
 *
 * The directory name IS the project attribution: `generateProjectId` yields a
 * stable `<slug>-<hash>` for an absolute path, identical to the id the global
 * project registry assigns. Per-project directories also give each project its
 * own rotation budget, so a busy project cannot evict a quiet one's history.
 */
export function resolveProjectMetricsDir(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveMetricsDir(env), generateProjectId(resolve(projectRoot)))
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
