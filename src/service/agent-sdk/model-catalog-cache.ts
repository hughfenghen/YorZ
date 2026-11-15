import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getLogger } from '../logger.js'
import type { AgentId, AgentModelCatalog } from './types.js'

const log = () => getLogger().child('agent-sdk')

/**
 * 模型目录是**宿主级**数据（provider 列表 / CLI 缓存 / SDK 能力探测），与项目目录无关，
 * 因此缓存键只用 agent kind，跨项目共用同一份。
 *
 * TTL 只决定「何时后台校准」，不决定「能否返回」：过期条目仍会立即返回旧值，
 * 由后台刷新补齐——设置页宁可短暂看到旧模型，也不要卡在 spinner 上等 opencode 服务端冷启动。
 */
export const MODEL_CATALOG_TTL_MS = 5 * 60 * 1000

/** 磁盘持久化去抖：短时间内多次写入（例如切换 kind）合并成一次落盘。 */
const PERSIST_DEBOUNCE_MS = 500

const CACHE_VERSION = 1

export type ModelCatalogLoader = () => Promise<AgentModelCatalog>

export interface AgentModelCatalogCacheOptions {
  ttlMs?: number
  /** 磁盘缓存文件绝对路径；缺省则只做内存缓存。 */
  filePath?: string
  /** 注入时钟，便于单测；缺省 `Date.now`。 */
  now?: () => number
}

interface CacheEntry {
  catalog: AgentModelCatalog
  fetchedAt: number
}

interface PersistedShape {
  version: number
  catalogs: Record<string, CacheEntry>
}

/**
 * 空目录不缓存：`AdapterRegistry.listModels` 在 adapter 失败/不支持时降级为空目录，
 * 缓存它会把一次性故障钉住整个 TTL。空目录照常返回给调用方，下次请求再试。
 */
function isCacheable(catalog: AgentModelCatalog): boolean {
  return catalog.models.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function parseCatalog(value: unknown): AgentModelCatalog | null {
  if (!isRecord(value)) return null
  const models = value.models
  if (!Array.isArray(models)) return null
  const defaults = value.defaultReasoningEfforts
  const catalog: AgentModelCatalog = {
    models: models.filter(isRecord).flatMap((model) => {
      const id = typeof model.id === 'string' ? model.id : ''
      if (!id) return []
      const options = Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : []
      return [
        {
          id,
          displayName: typeof model.displayName === 'string' ? model.displayName : id,
          reasoningEfforts: options.filter(isRecord).flatMap((option) => {
            const optionId = typeof option.id === 'string' ? option.id : ''
            if (!optionId) return []
            return [
              {
                id: optionId,
                displayName: typeof option.displayName === 'string' ? option.displayName : optionId,
              },
            ]
          }),
        },
      ]
    }),
    defaultReasoningEfforts: (Array.isArray(defaults) ? defaults : [])
      .filter(isRecord)
      .flatMap((option) => {
        const optionId = typeof option.id === 'string' ? option.id : ''
        if (!optionId) return []
        return [
          {
            id: optionId,
            displayName: typeof option.displayName === 'string' ? option.displayName : optionId,
          },
        ]
      }),
  }
  return catalog
}

/**
 * Agent 模型目录缓存（内存 + 可选磁盘）。语义为 stale-while-revalidate：
 *
 * - 未命中 → 冷路径，await loader；
 * - 命中且新鲜 → 直接用；
 * - 命中但过期 → 立即返回旧值，后台刷新（后台失败只告警，保留旧值）。
 *
 * 同一 kind 的并发请求合并成一个 Promise，避免两个路由（全局 / 项目）同时拉起两个
 * opencode 服务端。
 */
export class AgentModelCatalogCache {
  private readonly memory = new Map<AgentId, CacheEntry>()
  private readonly inflight = new Map<AgentId, Promise<AgentModelCatalog>>()
  private ttlMs = MODEL_CATALOG_TTL_MS
  private filePath: string | undefined
  private now: () => number = () => Date.now()
  private diskLoaded = false
  private diskLoading: Promise<void> | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: AgentModelCatalogCacheOptions = {}) {
    this.configure(options)
  }

  /** 运行时重配（`server.ts` 在启动时指定落盘路径；单测可切 TTL / 时钟）。 */
  configure(options: AgentModelCatalogCacheOptions): void {
    if (options.ttlMs !== undefined) this.ttlMs = options.ttlMs
    if (options.now) this.now = options.now
    if (options.filePath !== undefined && options.filePath !== this.filePath) {
      this.filePath = options.filePath
      this.diskLoaded = false
      this.diskLoading = null
    }
  }

  /** 取目录：命中即返回（可能触发后台刷新），未命中才等待 loader。 */
  async get(kind: AgentId, load: ModelCatalogLoader): Promise<AgentModelCatalog> {
    await this.ensureDiskLoaded()
    const entry = this.memory.get(kind)
    if (!entry) return this.refresh(kind, load)
    if (this.now() - entry.fetchedAt >= this.ttlMs) this.refreshInBackground(kind, load)
    return entry.catalog
  }

  /** 同步窥视（测试与诊断用）。 */
  peek(kind: AgentId): AgentModelCatalog | undefined {
    return this.memory.get(kind)?.catalog
  }

  /** 强制刷新（并发去重）。失败时原样抛给调用方，内存中的旧值保持不变。 */
  async refresh(kind: AgentId, load: ModelCatalogLoader): Promise<AgentModelCatalog> {
    const pending = this.inflight.get(kind)
    if (pending) return pending
    const task = load()
      .then((catalog) => {
        if (isCacheable(catalog)) {
          this.memory.set(kind, { catalog, fetchedAt: this.now() })
          this.schedulePersist()
        }
        return catalog
      })
      .finally(() => {
        this.inflight.delete(kind)
      })
    this.inflight.set(kind, task)
    return task
  }

  /** 丢弃缓存（缺省全部）；用于 agent 配置变更等需要下次重取的场景。 */
  invalidate(kind?: AgentId): void {
    if (kind) this.memory.delete(kind)
    else this.memory.clear()
    this.schedulePersist()
  }

  /** 清空内存与磁盘加载状态（单测复位用）。 */
  clear(): void {
    this.memory.clear()
    this.inflight.clear()
    this.diskLoaded = false
    this.diskLoading = null
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
  }

  /** 等待挂起的磁盘写入完成（测试与优雅退出用）。 */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
      await this.persist()
    }
  }

  private refreshInBackground(kind: AgentId, load: ModelCatalogLoader): void {
    void this.refresh(kind, load).catch((err: unknown) => {
      log().warn('agent model catalog refresh failed; keeping cached copy', {
        id: kind,
        message: err instanceof Error ? err.message : String(err),
      })
    })
  }

  private ensureDiskLoaded(): Promise<void> {
    if (this.diskLoaded || !this.filePath) return Promise.resolve()
    if (this.diskLoading) return this.diskLoading
    this.diskLoading = this.loadFromDisk().finally(() => {
      this.diskLoaded = true
      this.diskLoading = null
    })
    return this.diskLoading
  }

  private async loadFromDisk(): Promise<void> {
    const fp = this.filePath
    if (!fp) return
    let raw: string
    try {
      raw = await readFile(fp, 'utf8')
    } catch {
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (!isRecord(parsed) || !isRecord(parsed.catalogs)) return
    for (const [kind, value] of Object.entries(parsed.catalogs)) {
      if (!isRecord(value)) continue
      const catalog = parseCatalog(value.catalog)
      const fetchedAt = typeof value.fetchedAt === 'number' ? value.fetchedAt : 0
      if (!catalog || catalog.models.length === 0) continue
      // 磁盘数据只在内存缺失时补位，不覆盖本次进程内已经取到的新值。
      if (this.memory.has(kind)) continue
      this.memory.set(kind, { catalog, fetchedAt })
    }
  }

  private schedulePersist(): void {
    if (!this.filePath) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persist().catch((err: unknown) => {
        log().warn('agent model catalog persist failed', {
          message: err instanceof Error ? err.message : String(err),
        })
      })
    }, PERSIST_DEBOUNCE_MS)
    // 后台落盘不应阻止进程退出。
    this.persistTimer.unref?.()
  }

  private async persist(): Promise<void> {
    const fp = this.filePath
    if (!fp) return
    const body: PersistedShape = { version: CACHE_VERSION, catalogs: {} }
    for (const [kind, entry] of this.memory) {
      if (entry.catalog.models.length === 0) continue
      body.catalogs[kind] = entry
    }
    await mkdir(dirname(fp), { recursive: true })
    await writeFile(fp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  }
}

/** 进程内单例：全局路由与项目路由共用同一份目录缓存。 */
export const agentModelCatalogCache = new AgentModelCatalogCache()

/** 启动时配置单例（落盘路径 / TTL）。 */
export function configureAgentModelCatalogCache(options: AgentModelCatalogCacheOptions): void {
  agentModelCatalogCache.configure(options)
}
