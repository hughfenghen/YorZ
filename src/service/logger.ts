import { appendFile, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveGlobalConfigDir } from './global-config.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export const LOG_LEVELS = Object.keys(LEVEL_WEIGHT) as LogLevel[]

/** Single log file size cap: 5 MiB. */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
/** Keep exactly one archive (`serve.log.1`); disk peak ≈ 10 MiB. */
export const DEFAULT_MAX_ARCHIVES = 1
export const DEFAULT_LOG_FILE = 'serve.log'
/** Background stdio fallback file (truncated on every start, so unbounded growth is impossible). */
export const STDIO_LOG_FILE = 'serve-stdio.log'

export interface LoggerOptions {
  /** Directory the log files live in. Defaults to `<globalConfigDir>/logs`. */
  dir: string
  /** Main log file name. */
  fileName: string
  /** Rotate once the file would exceed this many bytes. */
  maxBytes: number
  /** How many `<fileName>.N` archives to keep. `0` truncates in place. */
  maxArchives: number
  /** Minimum level that gets emitted. */
  level: LogLevel
  /** Also mirror every emitted line to the console (visible in foreground mode). */
  mirrorConsole: boolean
}

export type LogMeta = Record<string, unknown>

/** `<globalConfigDir>/logs` — honours `YORZ_HOME` / `XDG_CONFIG_HOME`. */
export function resolveLogDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveGlobalConfigDir(env), 'logs')
}

export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevel {
  const raw = env.YORZ_LOG_LEVEL?.trim().toLowerCase()
  if (raw && (LOG_LEVELS as string[]).includes(raw)) return raw as LogLevel
  return 'info'
}

function defaultOptions(env: NodeJS.ProcessEnv = process.env): LoggerOptions {
  return {
    dir: resolveLogDir(env),
    fileName: DEFAULT_LOG_FILE,
    maxBytes: DEFAULT_MAX_BYTES,
    maxArchives: DEFAULT_MAX_ARCHIVES,
    level: resolveLogLevel(env),
    mirrorConsole: true,
  }
}

/**
 * Append-only sink with size-based rotation.
 *
 * All writes go through a single promise chain so concurrent callers can never
 * interleave a line or race the size counter. Every disk error is swallowed —
 * logging must never take the service down.
 */
export class RotatingFileSink {
  private currentSize = 0
  private initialized = false
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private dir: string,
    private fileName: string,
    private maxBytes: number,
    private maxArchives: number,
  ) {}

  get filePath(): string {
    return join(this.dir, this.fileName)
  }

  archivePath(index: number): string {
    return `${this.filePath}.${index}`
  }

  /** Enqueue a line; returns immediately, never throws. */
  write(line: string): void {
    this.queue = this.queue.then(() => this.writeNow(line)).catch(() => {})
  }

  /** Resolve once every queued line has been flushed to disk. */
  async flush(): Promise<void> {
    await this.queue.catch(() => {})
  }

  private async writeNow(line: string): Promise<void> {
    try {
      await this.ensureInit()
      const bytes = Buffer.byteLength(line, 'utf8')
      if (this.currentSize > 0 && this.currentSize + bytes > this.maxBytes) {
        await this.rotate()
      }
      await appendFile(this.filePath, line, 'utf8')
      this.currentSize += bytes
    } catch {
      // logging must never break the caller
    }
  }

  /** Lazily create the dir and recover `currentSize` from an existing file. */
  private async ensureInit(): Promise<void> {
    if (this.initialized) return
    await mkdir(this.dir, { recursive: true })
    try {
      const st = await stat(this.filePath)
      this.currentSize = st.size
    } catch {
      this.currentSize = 0
    }
    this.initialized = true
  }

  private async rotate(): Promise<void> {
    if (this.maxArchives <= 0) {
      await writeFile(this.filePath, '', 'utf8')
      this.currentSize = 0
      return
    }
    // Shift archives back: .N-1 -> .N (the oldest one is overwritten).
    for (let i = this.maxArchives - 1; i >= 1; i--) {
      try {
        await rename(this.archivePath(i), this.archivePath(i + 1))
      } catch {
        // that archive slot does not exist yet
      }
    }
    await rename(this.filePath, this.archivePath(1))
    this.currentSize = 0
  }
}

interface LoggerCore {
  options: LoggerOptions
  sink: RotatingFileSink
}

function createSink(options: LoggerOptions): RotatingFileSink {
  return new RotatingFileSink(options.dir, options.fileName, options.maxBytes, options.maxArchives)
}

function formatMeta(meta?: LogMeta): string {
  if (!meta) return ''
  const keys = Object.keys(meta)
  if (keys.length === 0) return ''
  try {
    return ` ${JSON.stringify(meta, jsonReplacer)}`
  } catch {
    return ''
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) return { message: value.message, stack: value.stack }
  if (typeof value === 'bigint') return value.toString()
  return value
}

export class Logger {
  constructor(
    private core: LoggerCore,
    private scope: string,
  ) {}

  get level(): LogLevel {
    return this.core.options.level
  }

  get filePath(): string {
    return this.core.sink.filePath
  }

  get dir(): string {
    return this.core.options.dir
  }

  /** Derive a logger that prefixes every line with `[scope]`. */
  child(scope: string): Logger {
    const next = this.scope && this.scope !== 'yorz' ? `${this.scope}:${scope}` : scope
    return new Logger(this.core, next)
  }

  debug(msg: string, meta?: LogMeta): void {
    this.emit('debug', msg, meta)
  }

  info(msg: string, meta?: LogMeta): void {
    this.emit('info', msg, meta)
  }

  warn(msg: string, meta?: LogMeta): void {
    this.emit('warn', msg, meta)
  }

  error(msg: string, meta?: LogMeta): void {
    this.emit('error', msg, meta)
  }

  /** Replace options in place; every existing child logger picks the change up. */
  configure(patch: Partial<LoggerOptions>): void {
    const prev = this.core.options
    const next: LoggerOptions = { ...prev, ...patch }
    this.core.options = next
    const sinkChanged =
      next.dir !== prev.dir ||
      next.fileName !== prev.fileName ||
      next.maxBytes !== prev.maxBytes ||
      next.maxArchives !== prev.maxArchives
    if (sinkChanged) this.core.sink = createSink(next)
  }

  async flush(): Promise<void> {
    await this.core.sink.flush()
  }

  private emit(level: LogLevel, msg: string, meta?: LogMeta): void {
    const { options } = this.core
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[options.level]) return
    const line = `[${new Date().toISOString()}] [${level}] [${this.scope}] ${msg}${formatMeta(meta)}\n`
    if (options.mirrorConsole) mirror(level, line)
    this.core.sink.write(line)
  }
}

function mirror(level: LogLevel, line: string): void {
  const text = line.endsWith('\n') ? line.slice(0, -1) : line
  try {
    if (level === 'error') console.error(text)
    else if (level === 'warn') console.warn(text)
    else console.log(text)
  } catch {
    // stdout may be closed in background mode
  }
}

export function createLogger(patch: Partial<LoggerOptions> = {}): Logger {
  const options: LoggerOptions = { ...defaultOptions(), ...patch }
  return new Logger({ options, sink: createSink(options) }, 'yorz')
}

let singleton: Logger | null = null

/** Process-wide logger. Scopes are created with `getLogger().child('http')`. */
export function getLogger(): Logger {
  if (!singleton) singleton = createLogger()
  return singleton
}

/** Reconfigure the process-wide logger (also used by tests to redirect the dir). */
export function configureLogger(patch: Partial<LoggerOptions>): Logger {
  const logger = getLogger()
  logger.configure(patch)
  return logger
}

/** Drop the singleton so the next `getLogger()` re-reads the environment. */
export function resetLogger(): void {
  singleton = null
}
