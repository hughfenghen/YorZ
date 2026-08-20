import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { generateProjectId } from '../global-config.js'
import { RotatingFileSink } from '../logger.js'
import {
  DEFAULT_TELEMETRY_MAX_ARCHIVES,
  DEFAULT_TELEMETRY_MAX_BYTES,
  PROJECT_META_FILE_NAME,
  TELEMETRY_FILE_NAME,
  resolveProjectMetricsDir,
} from './paths.js'
import {
  TELEMETRY_SCHEMA_VERSION,
  type ProjectMetricsMeta,
  type TelemetryEnvelope,
  type TelemetryEventName,
  type TelemetryPayload,
} from './types.js'

/** `YORZ_TELEMETRY=off` (or `0` / `false` / `disabled`) turns collection off. */
export function isTelemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.YORZ_TELEMETRY?.trim().toLowerCase()
  if (!raw) return true
  return !['off', '0', 'false', 'no', 'disabled'].includes(raw)
}

/**
 * Append-only recorder for one project.
 *
 * Every method is fire-and-forget: writes are queued on the sink's single
 * promise chain (no interleaved lines, no back-pressure on the caller) and all
 * disk errors are swallowed. Telemetry must never be able to break a dispatch.
 */
export class TelemetryRecorder {
  private readonly sink: RotatingFileSink | null
  private metaWritten = false

  constructor(
    readonly projectRoot: string,
    readonly projectId: string,
    readonly dir: string,
    readonly enabled: boolean,
  ) {
    this.sink = enabled
      ? new RotatingFileSink(
          dir,
          TELEMETRY_FILE_NAME,
          DEFAULT_TELEMETRY_MAX_BYTES,
          DEFAULT_TELEMETRY_MAX_ARCHIVES,
        )
      : null
  }

  get filePath(): string {
    return join(this.dir, TELEMETRY_FILE_NAME)
  }

  /** Queue one event. Returns immediately; never throws. */
  record(event: TelemetryEventName, payload: TelemetryPayload = {}): void {
    if (!this.sink) return
    let line: string
    try {
      const envelope: TelemetryEnvelope = {
        v: TELEMETRY_SCHEMA_VERSION,
        ts: nowStamp(),
        event,
        projectId: this.projectId,
        ...payload,
      }
      // `undefined` payload values disappear here, which is what keeps
      // "not measured" out of the file instead of landing as null.
      line = `${JSON.stringify(envelope)}\n`
    } catch {
      // unserializable payload (cycles, bigint) — drop the event, never throw
      return
    }
    this.sink.write(line)
    this.ensureMeta()
  }

  /** Resolve once every queued line has hit the disk (tests / shutdown). */
  async flush(): Promise<void> {
    await this.sink?.flush()
  }

  /** Write the id → absolute path sidecar once per process. Best-effort. */
  private ensureMeta(): void {
    if (this.metaWritten || !this.sink) return
    this.metaWritten = true
    const meta: ProjectMetricsMeta = {
      id: this.projectId,
      path: this.projectRoot,
      firstSeenAt: nowStamp(),
    }
    void (async () => {
      try {
        await mkdir(this.dir, { recursive: true })
        await writeFile(join(this.dir, PROJECT_META_FILE_NAME), `${JSON.stringify(meta, null, 2)}\n`)
      } catch {
        // metrics metadata is a convenience, not a requirement
      }
    })()
  }
}

const recorders = new Map<string, TelemetryRecorder>()

/**
 * Per-project recorder singleton.
 *
 * Every instrumentation point already holds the project root (SessionManager /
 * CommandManager cwd, `git.ts` cwd argument, watcher cwd, CLI `--cwd`), so no
 * existing signature has to grow a telemetry parameter.
 */
export function getTelemetry(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): TelemetryRecorder {
  const root = resolve(projectRoot)
  const cached = recorders.get(root)
  if (cached) return cached
  const recorder = new TelemetryRecorder(
    root,
    generateProjectId(root),
    resolveProjectMetricsDir(root, env),
    isTelemetryEnabled(env),
  )
  recorders.set(root, recorder)
  return recorder
}

/** Flush every live recorder (process shutdown, tests). */
export async function flushTelemetry(): Promise<void> {
  await Promise.all([...recorders.values()].map((r) => r.flush()))
}

/** Drop cached recorders so the next `getTelemetry()` re-reads the environment. */
export function resetTelemetry(): void {
  recorders.clear()
}

/** Local `YYYY-MM-DD HH:mm:ss`, matching spec frontmatter `updated_at`. */
function nowStamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
