import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { SpecStore } from './spec-store.js'
import { SpecWatcher } from './watcher.js'
import { AgentRunner } from './agent.js'
import { AgentLogStore } from './agent-log-store.js'
import { AttachmentStore } from './attachment-store.js'
import { ensureSpecsDirExists, loadProjectConfig, resolveSpecsDir } from './project-config.js'
import {
  addProject,
  generateProjectId,
  loadGlobalConfig,
  prepareProjectDir,
  removeProject,
  resolveGlobalConfigPath,
  type GlobalProjectEntry,
  type WorktreeMeta,
} from './global-config.js'

export interface ProjectInstance {
  id: string
  path: string
  /** Absolute path to the spec directory. */
  specsDir: string
  /** POSIX-style spec directory path relative to project root. */
  specsDirRelative: string
  store: SpecStore
  watcher: SpecWatcher
  runner: AgentRunner
  attachments: AttachmentStore
  agentLogs: AgentLogStore
  /** Stop watchers + free resources. Idempotent. */
  close(): Promise<void>
}

export interface ProjectInstanceInput {
  id: string
  path: string
}

export interface ProjectListItem {
  id: string
  name: string
  path: string
  lastActivityAt: string | null
  worktree?: WorktreeMeta
}

export interface ProjectRegistryOptions {
  globalConfigPath?: string
}

interface CachedInstance {
  instance: ProjectInstance
  startPromise: Promise<void>
}

export class ProjectRegistry {
  private readonly globalConfigPath?: string
  private readonly cache = new Map<string, CachedInstance>()

  constructor(opts: ProjectRegistryOptions = {}) {
    this.globalConfigPath = opts.globalConfigPath
  }

  configPath(): string {
    return this.globalConfigPath ?? resolveGlobalConfigPath()
  }

  async list(): Promise<ProjectListItem[]> {
    const config = await loadGlobalConfig(this.globalConfigPath)
    const items: Array<ProjectListItem & { sortKey: string }> = []
    for (const p of config.projects) {
      const name = basename(p.path)
      const fallback = await maxSpecUpdatedAt(p.path)
      const sortKey = p.lastActivityAt ?? fallback ?? ''
      const item: ProjectListItem & { sortKey: string } = {
        id: p.id,
        name,
        path: p.path,
        lastActivityAt: p.lastActivityAt,
        sortKey,
      }
      if (p.worktree) item.worktree = p.worktree
      items.push(item)
    }
    items.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0))
    return items.map(({ id, name, path, lastActivityAt, worktree }) => {
      const out: ProjectListItem = { id, name, path, lastActivityAt }
      if (worktree) out.worktree = worktree
      return out
    })
  }

  async findEntry(id: string): Promise<GlobalProjectEntry | null> {
    const config = await loadGlobalConfig(this.globalConfigPath)
    return config.projects.find((p) => p.id === id) ?? null
  }

  /** Lazily construct (and cache) the in-memory instance for a given project. */
  async getOrCreate(id: string): Promise<ProjectInstance | null> {
    const cached = this.cache.get(id)
    if (cached) {
      await cached.startPromise
      return cached.instance
    }
    const entry = await this.findEntry(id)
    if (!entry) return null
    const instance = await this.materialize({ id: entry.id, path: entry.path })
    return instance
  }

  async add(absPath: string): Promise<{ entry: GlobalProjectEntry; created: boolean }> {
    if (!isAbsolute(absPath)) throw new Error(`path must be absolute: ${absPath}`)
    const normalized = await prepareProjectDir(absPath)
    return await addProject(normalized, this.globalConfigPath)
  }

  async remove(id: string): Promise<boolean> {
    const cached = this.cache.get(id)
    if (cached) {
      try {
        await cached.instance.close()
      } catch {
        // best-effort
      }
      this.cache.delete(id)
    }
    return await removeProject(id, this.globalConfigPath)
  }

  /**
   * Drop the cached instance for a project so the next getOrCreate() rebuilds
   * SpecStore + watcher with the current project config. Used after the
   * project's `.yorz/config.json` changes (e.g. specsDir or agent override).
   */
  async reload(id: string): Promise<void> {
    const cached = this.cache.get(id)
    if (!cached) return
    try {
      await cached.instance.close()
    } catch {
      // best-effort
    }
    this.cache.delete(id)
  }

  async closeAll(): Promise<void> {
    const tasks: Array<Promise<void>> = []
    for (const c of this.cache.values()) {
      tasks.push(
        c.instance.close().catch(() => {
          // best-effort
        }),
      )
    }
    this.cache.clear()
    await Promise.all(tasks)
  }

  /** Test helper / explicit registration with a known id. */
  async registerExistingId(absPath: string): Promise<GlobalProjectEntry> {
    const id = generateProjectId(absPath)
    const cached = await this.add(absPath)
    return cached.entry ?? { id, path: absPath, addedAt: '', lastActivityAt: null }
  }

  private async materialize(input: ProjectInstanceInput): Promise<ProjectInstance> {
    const cfg = await loadProjectConfig(input.path)
    const specsDir = resolveSpecsDir(input.path, cfg)
    const specsDirRelative = posixRelative(input.path, specsDir)
    await ensureSpecsDirExists(specsDir)
    const watcher = new SpecWatcher({ cwd: input.path, specsDir })
    const store = new SpecStore({
      cwd: input.path,
      specsDir,
      onWrite: (path, mtime) => watcher.markSelfWrite(path, mtime),
    })
    const agentLogs = new AgentLogStore({ cwd: input.path })
    const runner = new AgentRunner({
      cwd: input.path,
      projectId: input.id,
      globalConfigPath: this.globalConfigPath,
      logStore: agentLogs,
    })
    const attachments = new AttachmentStore({ cwd: input.path })

    let closed = false
    const instance: ProjectInstance = {
      id: input.id,
      path: input.path,
      specsDir,
      specsDirRelative,
      store,
      watcher,
      runner,
      attachments,
      agentLogs,
      async close() {
        if (closed) return
        closed = true
        await watcher.close()
      },
    }

    const startPromise = (async () => {
      await store.ensureRoot()
      await attachments.ensureRoot()
      void attachments.cleanupExpired().catch(() => {})
      await agentLogs.ensureRoot()
      void agentLogs.cleanupExpired().catch(() => {})
      await watcher.start()
    })()

    this.cache.set(input.id, { instance, startPromise })
    await startPromise
    return instance
  }
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function posixRelative(from: string, to: string): string {
  return relative(resolvePath(from), to).split(sep).join('/')
}

async function maxSpecUpdatedAt(projectPath: string): Promise<string | null> {
  try {
    const cfg = await loadProjectConfig(projectPath)
    const specsDir = resolveSpecsDir(projectPath, cfg)
    if (!existsSync(specsDir)) return null
    // Reuse SpecStore.list() semantics: max(updated_at) among specs
    const store = new SpecStore({ cwd: projectPath, specsDir })
    const items = await store.list()
    if (items.length === 0) return null
    let best: string = ''
    for (const it of items) {
      if (it.updated_at && it.updated_at > best) best = it.updated_at
    }
    return best || null
  } catch {
    return null
  }
}
