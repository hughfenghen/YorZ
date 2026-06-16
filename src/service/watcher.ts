import { stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'

export type WatcherEvent = 'updated' | 'removed'
export type DetailListener = (evt: WatcherEvent, mtime: number) => void
export type ListListener = () => void

export interface WatcherOptions {
  cwd: string
}

export class SpecWatcher {
  private readonly root: string
  private readonly detailListeners = new Map<string, Set<DetailListener>>()
  private readonly listListeners = new Set<ListListener>()
  /** specId → most recent mtime we ourselves just wrote (echo suppression). */
  private readonly suppress = new Map<string, number>()
  private watcher: FSWatcher | null = null

  constructor(opts: WatcherOptions) {
    this.root = join(opts.cwd, '.yorz', 'specs')
  }

  async start(): Promise<void> {
    if (this.watcher) return
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      depth: 2,
    })
    this.watcher.on('add', (p) => this.handle(p, 'updated'))
    this.watcher.on('change', (p) => this.handle(p, 'updated'))
    this.watcher.on('unlink', (p) => this.handle(p, 'removed'))
    await new Promise<void>((resolve, reject) => {
      this.watcher!.once('ready', () => resolve())
      this.watcher!.once('error', (err) => reject(err))
    })
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }

  /** Record an mtime that we wrote ourselves so the next watcher event for it can be ignored. */
  markSelfWrite(filePath: string, mtimeMs: number): void {
    const id = this.idForPath(filePath)
    if (id) this.suppress.set(id, mtimeMs)
  }

  subscribe(specId: string, cb: DetailListener): () => void {
    let set = this.detailListeners.get(specId)
    if (!set) {
      set = new Set()
      this.detailListeners.set(specId, set)
    }
    set.add(cb)
    return () => {
      set!.delete(cb)
      if (set!.size === 0) this.detailListeners.delete(specId)
    }
  }

  subscribeList(cb: ListListener): () => void {
    this.listListeners.add(cb)
    return () => this.listListeners.delete(cb)
  }

  private async handle(filePath: string, evt: WatcherEvent): Promise<void> {
    if (basename(filePath) !== 'spec.md') return
    const id = this.idForPath(filePath)
    if (!id) return
    let mtimeMs = 0
    if (evt === 'updated') {
      try {
        const stats = await stat(filePath)
        mtimeMs = stats.mtimeMs
      } catch {
        return
      }
      const suppressed = this.suppress.get(id)
      if (suppressed !== undefined && Math.abs(suppressed - mtimeMs) < 5) {
        this.suppress.delete(id)
        return
      }
    } else {
      this.suppress.delete(id)
    }
    for (const cb of this.detailListeners.get(id) ?? []) cb(evt, mtimeMs)
    for (const cb of this.listListeners) cb()
  }

  private idForPath(filePath: string): string | null {
    const rel = relative(this.root, filePath)
    if (rel.startsWith('..')) return null
    const parts = rel.split(sep)
    if (parts.length < 2 || parts[1] !== 'spec.md') return null
    return parts[0]
  }
}
