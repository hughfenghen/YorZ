import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, sep as pathSep } from 'node:path'

export interface TouchedFilesStoreOptions {
  cwd: string
}

interface PersistShape {
  paths: string[]
}

export class TouchedFilesStore {
  private readonly cwd: string
  private readonly locks = new Map<string, Promise<void>>()

  constructor(opts: TouchedFilesStoreOptions) {
    this.cwd = opts.cwd
  }

  async add(specId: string, rawPaths: string[]): Promise<void> {
    const normalized = this.normalize(rawPaths)
    if (normalized.length === 0) return
    await this.withLock(specId, async () => {
      const existing = await this.readRaw(specId)
      const merged = new Set(existing)
      for (const p of normalized) merged.add(p)
      if (merged.size === existing.length && normalized.every((p) => existing.includes(p))) return
      await this.persist(specId, Array.from(merged).sort())
    })
  }

  async read(specId: string): Promise<string[]> {
    return this.readRaw(specId)
  }

  async remove(specId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return
    await this.withLock(specId, async () => {
      const existing = await this.readRaw(specId)
      if (existing.length === 0) return
      const drop = new Set(paths)
      const remaining = existing.filter((p) => !drop.has(p))
      if (remaining.length === existing.length) return
      if (remaining.length === 0) {
        await rm(this.filePath(specId), { force: true })
        return
      }
      await this.persist(specId, remaining)
    })
  }

  filePath(specId: string): string {
    return join(this.cwd, '.yorz', 'specs', specId, 'touched-files.json')
  }

  /** Path of the persisted JSON relative to cwd (POSIX style), useful for route filtering. */
  relativeFilePath(specId: string): string {
    return ['.yorz', 'specs', specId, 'touched-files.json'].join('/')
  }

  private normalize(rawPaths: string[]): string[] {
    const out: string[] = []
    for (const raw of rawPaths) {
      if (typeof raw !== 'string') continue
      const trimmed = raw.trim()
      if (!trimmed) continue
      let rel = trimmed
      if (isAbsolute(rel)) {
        rel = relative(this.cwd, rel)
      }
      if (!rel || rel.startsWith('..') || rel === '.') continue
      // Normalize to POSIX separators (git status outputs POSIX-style on macOS/Linux).
      const posix = rel.split(pathSep).join('/')
      out.push(posix)
    }
    return out
  }

  private async readRaw(specId: string): Promise<string[]> {
    const fp = this.filePath(specId)
    if (!existsSync(fp)) return []
    try {
      const raw = await readFile(fp, 'utf8')
      const parsed = JSON.parse(raw) as PersistShape
      if (!parsed || !Array.isArray(parsed.paths)) return []
      return parsed.paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    } catch {
      return []
    }
  }

  private async persist(specId: string, paths: string[]): Promise<void> {
    const fp = this.filePath(specId)
    await mkdir(join(this.cwd, '.yorz', 'specs', specId), { recursive: true })
    const body: PersistShape = { paths }
    await writeFile(fp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  }

  private async withLock<T>(specId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(specId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.then(
      () => undefined,
      () => undefined,
    )
    this.locks.set(specId, tail)
    return next
  }
}
