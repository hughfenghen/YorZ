import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CommandRun } from './command-types.js'

/**
 * Project-level command run index. Mirrors `SessionStore`'s in-memory cache +
 * serialized write chain, with a tmp+rename atomic write so a crash mid-write
 * cannot leave a truncated index behind.
 */
export class CommandRunStore {
  private readonly file: string
  private cache: CommandRun[] | null = null
  private loadPromise: Promise<CommandRun[]> | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(projectPath: string) {
    this.file = join(projectPath, '.yorz', 'tmp', 'commands', 'index.json')
  }

  /**
   * The in-flight read is memoized, not just its result: concurrent callers
   * must end up mutating the *same* array. Racing reads that each install a
   * fresh cache would silently drop every upsert but the last.
   */
  private load(): Promise<CommandRun[]> {
    if (this.cache) return Promise.resolve(this.cache)
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        let items: CommandRun[] = []
        try {
          const raw = await readFile(this.file, 'utf8')
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) items = parsed as CommandRun[]
        } catch {
          items = []
        }
        this.cache ??= items
        return this.cache
      })()
    }
    return this.loadPromise
  }

  private async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      // Snapshot inside the chain, not outside: queued writes must serialize
      // against the *latest* cache, otherwise a later mutation can be lost.
      const body = JSON.stringify(this.cache ?? [], null, 2)
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp-${process.pid}-${Date.now().toString(36)}`
      await writeFile(tmp, body, 'utf8')
      await rename(tmp, this.file)
    })
    await this.writeChain
  }

  /** Newest run first. */
  async list(): Promise<CommandRun[]> {
    const items = await this.load()
    return [...items].sort((a, b) => b.startedAt - a.startedAt)
  }

  async get(runId: string): Promise<CommandRun | undefined> {
    const items = await this.load()
    return items.find((r) => r.runId === runId)
  }

  async upsert(run: CommandRun): Promise<void> {
    const items = await this.load()
    const idx = items.findIndex((r) => r.runId === run.runId)
    if (idx >= 0) items[idx] = { ...items[idx], ...run }
    else items.push(run)
    await this.persist()
  }

  async remove(runId: string): Promise<boolean> {
    const items = await this.load()
    const idx = items.findIndex((r) => r.runId === runId)
    if (idx < 0) return false
    items.splice(idx, 1)
    await this.persist()
    return true
  }

  /** Bulk replace, used by the startup reap pass. */
  async replaceAll(runs: CommandRun[]): Promise<void> {
    await this.load()
    this.cache = [...runs]
    this.loadPromise = Promise.resolve(this.cache)
    await this.persist()
  }
}
