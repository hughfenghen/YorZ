import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentKind, SessionInfo } from './agent-sdk/types.js'

/**
 * Project-level session index. Persists only metadata (id/title/kind/times);
 * conversation history is read live from each adapter (SDK-native for
 * claude/opencode, ~/.codex/sessions JSONL for codex).
 */
export class SessionStore {
  private readonly file: string
  private cache: SessionInfo[] | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(projectPath: string) {
    this.file = join(projectPath, '.yorz', 'tmp', 'sessions', 'index.json')
  }

  private async load(): Promise<SessionInfo[]> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      this.cache = Array.isArray(parsed) ? (parsed as SessionInfo[]) : []
    } catch {
      this.cache = []
    }
    return this.cache
  }

  private async persist(): Promise<void> {
    const snapshot = this.cache ?? []
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(this.file, JSON.stringify(snapshot, null, 2), 'utf8')
    })
    await this.writeChain
  }

  async list(): Promise<SessionInfo[]> {
    const items = await this.load()
    return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<SessionInfo | undefined> {
    const items = await this.load()
    return items.find((s) => s.id === id)
  }

  /**
   * Every session bound to a spec, oldest first. A spec now owns MANY sessions
   * (one per system-driven round), so this — not a single lookup — is the
   * primitive: chronological order is what the Chat panel's aggregated
   * transcript is stitched from.
   */
  async listBySpec(specId: string): Promise<SessionInfo[]> {
    const items = await this.load()
    return items.filter((s) => s.specId === specId).sort((a, b) => a.createdAt - b.createdAt)
  }

  /** The spec's most recently active session — where user-driven turns land. */
  async latestBySpec(specId: string): Promise<SessionInfo | undefined> {
    const items = await this.load()
    let latest: SessionInfo | undefined
    for (const s of items) {
      if (s.specId !== specId) continue
      if (!latest || s.updatedAt > latest.updatedAt) latest = s
    }
    return latest
  }

  async upsert(info: SessionInfo): Promise<void> {
    const items = await this.load()
    const idx = items.findIndex((s) => s.id === info.id)
    if (idx >= 0) items[idx] = { ...items[idx], ...info }
    else items.push(info)
    await this.persist()
  }

  async create(kind: AgentKind, id: string, title: string, specId?: string): Promise<SessionInfo> {
    const now = Date.now()
    const info: SessionInfo = { id, title, kind, createdAt: now, updatedAt: now }
    if (specId) info.specId = specId
    await this.upsert(info)
    return info
  }

  /** Rewrite a provisional/empty id once the adapter surfaces the real one. */
  async reconcileId(oldId: string, newId: string): Promise<void> {
    if (oldId === newId) return
    const items = await this.load()
    const entry = items.find((s) => s.id === oldId)
    if (!entry) return
    entry.id = newId
    entry.updatedAt = Date.now()
    await this.persist()
  }

  async updateTitle(id: string, title: string): Promise<void> {
    const items = await this.load()
    const entry = items.find((s) => s.id === id)
    if (!entry) return
    entry.title = title
    entry.updatedAt = Date.now()
    await this.persist()
  }

  async bindSpec(id: string, specId: string): Promise<boolean> {
    const items = await this.load()
    const entry = items.find((s) => s.id === id)
    if (!entry) return false
    entry.specId = specId
    entry.updatedAt = Date.now()
    await this.persist()
    return true
  }

  async touch(id: string): Promise<void> {
    const items = await this.load()
    const entry = items.find((s) => s.id === id)
    if (!entry) return
    entry.updatedAt = Date.now()
    await this.persist()
  }
}
