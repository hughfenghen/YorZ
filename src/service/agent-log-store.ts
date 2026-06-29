import { existsSync } from 'node:fs'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentMode } from './agent.js'

export interface AgentLogMeta {
  runId: string
  specId: string
  mode: AgentMode
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  error?: string
  sizeBytes: number
}

export interface AgentLogWriter {
  append(chunk: string): void
  finalize(input: { exitCode: number | null; error?: string }): Promise<void>
}

export interface AgentLogStoreOptions {
  cwd: string
  now?: () => number
  ttlMs?: number
}

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000

function isSafeId(id: string): boolean {
  if (!id) return false
  if (id.includes('/') || id.includes('\\')) return false
  if (id === '.' || id === '..') return false
  if (id.startsWith('.')) return false
  return true
}

export class AgentLogStore {
  private readonly root: string
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(opts: AgentLogStoreOptions) {
    this.root = join(opts.cwd, '.yorz', 'tmp', 'agent-logs')
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.now = opts.now ?? (() => Date.now())
  }

  get rootDir(): string {
    return this.root
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  private specDir(specId: string): string {
    return join(this.root, specId)
  }

  private logPath(specId: string, runId: string): string {
    return join(this.specDir(specId), `${runId}.log`)
  }

  private metaPath(specId: string, runId: string): string {
    return join(this.specDir(specId), `${runId}.json`)
  }

  async openWriter(input: {
    runId: string
    specId: string
    mode: AgentMode
    startedAt: number
  }): Promise<AgentLogWriter> {
    if (!isSafeId(input.specId) || !isSafeId(input.runId)) {
      throw new Error(`unsafe id: specId=${input.specId} runId=${input.runId}`)
    }
    const dir = this.specDir(input.specId)
    await mkdir(dir, { recursive: true })
    const initialMeta: AgentLogMeta = {
      runId: input.runId,
      specId: input.specId,
      mode: input.mode,
      startedAt: input.startedAt,
      endedAt: null,
      exitCode: null,
      sizeBytes: 0,
    }
    await writeFile(this.metaPath(input.specId, input.runId), JSON.stringify(initialMeta), 'utf8')

    const logFile = this.logPath(input.specId, input.runId)
    const stream: WriteStream = createWriteStream(logFile, { flags: 'a' })
    let streamErr: Error | null = null
    stream.on('error', (err) => {
      streamErr = err
    })

    let finalized = false
    return {
      append(chunk: string): void {
        if (finalized || !chunk) return
        try {
          stream.write(chunk)
        } catch {
          // swallow — best-effort write
        }
      },
      finalize: async ({ exitCode, error }) => {
        if (finalized) return
        finalized = true
        await new Promise<void>((resolve) => {
          stream.end(() => resolve())
        })
        let sizeBytes = 0
        try {
          const s = await stat(logFile)
          sizeBytes = s.size
        } catch {
          // file may not exist if nothing was written
        }
        const finalError = error ?? (streamErr as Error | null)?.message
        const meta: AgentLogMeta = {
          runId: input.runId,
          specId: input.specId,
          mode: input.mode,
          startedAt: input.startedAt,
          endedAt: this.now(),
          exitCode,
          ...(finalError ? { error: finalError } : {}),
          sizeBytes,
        }
        try {
          await writeFile(this.metaPath(input.specId, input.runId), JSON.stringify(meta), 'utf8')
        } catch {
          // best-effort
        }
      },
    }
  }

  async listBySpec(specId: string): Promise<AgentLogMeta[]> {
    if (!isSafeId(specId)) return []
    const dir = this.specDir(specId)
    if (!existsSync(dir)) return []
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const out: AgentLogMeta[] = []
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue
      try {
        const raw = await readFile(join(dir, e.name), 'utf8')
        const meta = JSON.parse(raw) as AgentLogMeta
        if (
          typeof meta.runId === 'string' &&
          typeof meta.specId === 'string' &&
          typeof meta.startedAt === 'number'
        ) {
          out.push(meta)
        }
      } catch {
        // skip corrupt entries
      }
    }
    out.sort((a, b) => b.startedAt - a.startedAt)
    return out
  }

  async readLog(
    specId: string,
    runId: string,
    opts?: { maxBytes?: number },
  ): Promise<{ content: string; truncated: boolean }> {
    if (!isSafeId(specId) || !isSafeId(runId)) {
      return { content: '', truncated: false }
    }
    const file = this.logPath(specId, runId)
    if (!existsSync(file)) return { content: '', truncated: false }
    const maxBytes = opts?.maxBytes
    if (!maxBytes) {
      const buf = await readFile(file, 'utf8')
      return { content: buf, truncated: false }
    }
    const s = await stat(file)
    if (s.size <= maxBytes) {
      const buf = await readFile(file, 'utf8')
      return { content: buf, truncated: false }
    }
    const fh = await open(file, 'r')
    try {
      const buf = Buffer.alloc(maxBytes)
      await fh.read(buf, 0, maxBytes, s.size - maxBytes)
      return { content: buf.toString('utf8'), truncated: true }
    } finally {
      await fh.close()
    }
  }

  async cleanupExpired(): Promise<{ removed: string[] }> {
    if (!existsSync(this.root)) return { removed: [] }
    const removed: string[] = []
    let specDirs
    try {
      specDirs = await readdir(this.root, { withFileTypes: true })
    } catch {
      return { removed }
    }
    const cutoff = this.now() - this.ttlMs
    for (const sd of specDirs) {
      if (!sd.isDirectory()) continue
      const specId = sd.name
      const dir = this.specDir(specId)
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.json')) continue
        const runId = e.name.slice(0, -'.json'.length)
        const metaFile = join(dir, e.name)
        const logFile = this.logPath(specId, runId)
        let referenceTime: number | null = null
        try {
          const raw = await readFile(metaFile, 'utf8')
          const meta = JSON.parse(raw) as AgentLogMeta
          referenceTime = typeof meta.endedAt === 'number' ? meta.endedAt : null
        } catch {
          referenceTime = null
        }
        if (referenceTime === null) {
          try {
            const s = await stat(metaFile)
            referenceTime = s.mtimeMs
          } catch {
            continue
          }
        }
        if (referenceTime > cutoff) continue
        try {
          await rm(logFile, { force: true })
        } catch {
          // ignore
        }
        try {
          await rm(metaFile, { force: true })
          removed.push(runId)
        } catch {
          // ignore
        }
      }
    }
    return { removed }
  }
}
