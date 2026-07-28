import { mkdirSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import { getLogger } from './logger.js'

const DEBOUNCE_MS = 200

const registryLog = () => getLogger().child('registry')

/**
 * Tiny pub/sub for "the global project registry just changed". Subscribers (SSE
 * endpoints) get notified so the GUI can refetch its project list.
 *
 * Why a bus and not just FS watch on the GUI side: the GUI only sees the HTTP
 * surface, and FS watches on the registry file are unreliable (atomic writes
 * via tmp+rename break per-file watchers). Watching the parent dir + debouncing
 * gives us a single coalesced "something changed" tick that the service can
 * also raise explicitly after its own mutations.
 */
export class RegistryEventBus {
  private readonly subs = new Set<() => void>()
  private watcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null

  subscribe(cb: () => void): () => void {
    this.subs.add(cb)
    return () => {
      this.subs.delete(cb)
    }
  }

  emit(): void {
    for (const cb of this.subs) {
      try {
        cb()
      } catch {
        // best-effort fanout
      }
    }
  }

  start(globalConfigPath: string): void {
    if (this.watcher) return
    const dir = dirname(globalConfigPath)
    const fname = basename(globalConfigPath)
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // best-effort; if dir cannot be created we just skip watching
    }
    try {
      this.watcher = watch(dir, { persistent: false }, (_evt, filename) => {
        if (filename && String(filename) !== fname) return
        this.scheduleEmit()
      })
    } catch (err) {
      registryLog().warn('projects.json watch failed', { dir, message: (err as Error).message })
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.watcher?.close()
    this.watcher = null
  }

  private scheduleEmit(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.emit()
    }, DEBOUNCE_MS)
    this.debounceTimer.unref?.()
  }
}
