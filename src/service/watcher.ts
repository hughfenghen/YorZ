import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'

export type WatcherEvent = 'updated' | 'removed'
export type DetailListener = (evt: WatcherEvent, mtime: number) => void
export type ListListener = () => void

/**
 * How long to wait before trusting an `unlink` event. Editors and agents write
 * atomically (write temp file → rename over the target), which surfaces as a
 * transient unlink+add pair. Dispatching `removed` during that window makes the
 * GUI refetch a file that momentarily does not exist → 404.
 */
const UNLINK_SETTLE_MS = 80

export interface WatcherOptions {
  cwd: string
  /**
   * Absolute path to the spec directory. When omitted, defaults to
   * `<cwd>/.yorz/specs` for backward compatibility.
   */
  specsDir?: string
  /** Settle window for `unlink` events. Exposed for tests; defaults to 80ms. */
  unlinkSettleMs?: number
}

export class SpecWatcher {
  private readonly root: string
  private readonly unlinkSettleMs: number
  private readonly detailListeners = new Map<string, Set<DetailListener>>()
  private readonly listListeners = new Set<ListListener>()
  /** specId → most recent mtime we ourselves just wrote (echo suppression). */
  private readonly suppress = new Map<string, number>()
  /** specId → pending unlink settle timer (cleared on close). */
  private readonly pendingUnlinks = new Map<string, NodeJS.Timeout>()
  private watcher: FSWatcher | null = null

  constructor(opts: WatcherOptions) {
    this.root = opts.specsDir ?? join(opts.cwd, '.yorz', 'specs')
    this.unlinkSettleMs = opts.unlinkSettleMs ?? UNLINK_SETTLE_MS
  }

  async start(): Promise<void> {
    if (this.watcher) return
    const usePolling = process.env.YORZ_WATCH_USE_POLLING === '1'
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      depth: 2,
      ...(usePolling ? { usePolling: true, interval: 100 } : {}),
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
    for (const timer of this.pendingUnlinks.values()) clearTimeout(timer)
    this.pendingUnlinks.clear()
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

    if (evt === 'removed') {
      this.scheduleUnlink(id, filePath)
      return
    }

    // The file is back (or was never really gone) — cancel any pending unlink so
    // an atomic rewrite never surfaces as `removed`.
    const pending = this.pendingUnlinks.get(id)
    if (pending) {
      clearTimeout(pending)
      this.pendingUnlinks.delete(id)
    }

    let mtimeMs = 0
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
    this.emit(id, 'updated', mtimeMs)
  }

  /**
   * Hold an `unlink` for a settle window, then re-check the file. If it came
   * back it was an atomic rewrite — drop the event and let the paired add/change
   * drive `updated`. Only a file that is still gone counts as a real removal.
   */
  private scheduleUnlink(id: string, filePath: string): void {
    const existing = this.pendingUnlinks.get(id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.pendingUnlinks.delete(id)
      if (existsSync(filePath)) return
      this.suppress.delete(id)
      this.emit(id, 'removed', 0)
    }, this.unlinkSettleMs)
    timer.unref?.()
    this.pendingUnlinks.set(id, timer)
  }

  private emit(id: string, evt: WatcherEvent, mtimeMs: number): void {
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
