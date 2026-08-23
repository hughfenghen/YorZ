import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { generateProjectId } from '../global-config.js'
import { RotatingFileSink } from '../logger.js'
import {
  TELEMETRY_FILE_NAME,
  TELEMETRY_MAX_ARCHIVES,
  TELEMETRY_MAX_BYTES,
  resolveMetricsDir,
  resolveProjectsIndexFile,
} from './paths.js'
import {
  TELEMETRY_SCHEMA_VERSION,
  type ProjectsIndex,
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
 * One sink per metrics directory, shared by every project.
 *
 * Sharing is not an optimisation but a correctness requirement: the sink's
 * atomicity comes from serialising all writes onto a single promise chain, and
 * two sinks pointed at the same path would each keep their own chain — enough
 * to interleave halves of two lines.
 */
const sinks = new Map<string, RotatingFileSink>()

/**
 * One read-modify-write chain per index file, for the same reason: two
 * recorders merging themselves into `projects.json` concurrently would each
 * read the pre-merge state and the later write would erase the earlier one.
 */
const indexQueues = new Map<string, Promise<void>>()

function enqueueIndexUpdate(file: string, task: () => Promise<void>): void {
  const next = (indexQueues.get(file) ?? Promise.resolve()).then(task).catch(() => {
    // the index is a convenience for the read side, not a requirement
  })
  indexQueues.set(file, next)
}

function getSink(dir: string): RotatingFileSink {
  let sink = sinks.get(dir)
  if (!sink) {
    sink = new RotatingFileSink(dir, TELEMETRY_FILE_NAME, TELEMETRY_MAX_BYTES, TELEMETRY_MAX_ARCHIVES)
    sinks.set(dir, sink)
  }
  return sink
}

/**
 * Append-only recorder for one project.
 *
 * Every method is fire-and-forget: writes are queued on the shared sink's
 * single promise chain (no interleaved lines, no back-pressure on the caller)
 * and all disk errors are swallowed. Telemetry must never break a dispatch.
 */
export class TelemetryRecorder {
  private readonly sink: RotatingFileSink | null
  private indexWritten = false

  constructor(
    readonly projectRoot: string,
    readonly projectId: string,
    readonly dir: string,
    readonly enabled: boolean,
    private readonly indexFile: string,
  ) {
    this.sink = enabled ? getSink(dir) : null
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
        ts: Date.now(),
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
    this.ensureIndexed()
  }

  /** Resolve once every queued line has hit the disk (tests / shutdown). */
  async flush(): Promise<void> {
    await this.sink?.flush()
    await indexQueues.get(this.indexFile)
  }

  /** Merge this project into `projects.json` once per process. Best-effort. */
  private ensureIndexed(): void {
    if (this.indexWritten || !this.sink) return
    this.indexWritten = true
    const { projectId, projectRoot, indexFile } = this
    enqueueIndexUpdate(indexFile, async () => {
      let index: ProjectsIndex = {}
      try {
        index = JSON.parse(await readFile(indexFile, 'utf8')) as ProjectsIndex
      } catch {
        // no index yet (or it was corrupted) — start a fresh one
      }
      const existing = index[projectId]
      if (existing?.path === projectRoot) return
      index[projectId] = {
        path: projectRoot,
        firstSeenAt: existing?.firstSeenAt ?? Date.now(),
      }
      await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`)
    })
  }
}

const recorders = new Map<string, TelemetryRecorder>()

/**
 * Per-project recorder singleton.
 *
 * Every instrumentation point already holds the project root (SessionManager /
 * CommandManager cwd, watcher cwd, CLI `--cwd`), so no existing signature has
 * to grow a telemetry parameter. All recorders write the same file and are
 * told apart by the `projectId` carried on every line.
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
    resolveMetricsDir(env),
    isTelemetryEnabled(env),
    resolveProjectsIndexFile(env),
  )
  recorders.set(root, recorder)
  return recorder
}

/** Flush every live recorder (process shutdown, tests). */
export async function flushTelemetry(): Promise<void> {
  await Promise.all([...recorders.values()].map((r) => r.flush()))
}

/**
 * Drop cached recorders and sinks so the next `getTelemetry()` re-reads the
 * environment. Also used by the startup prune, which must not rewrite a file
 * while a stale sink still believes it knows the file's size.
 */
export function resetTelemetry(): void {
  recorders.clear()
  sinks.clear()
  indexQueues.clear()
}
