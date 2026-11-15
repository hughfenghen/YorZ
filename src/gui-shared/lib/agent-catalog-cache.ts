import { createSignal } from 'solid-js'
import type { AgentDescriptor, AgentModelCatalog } from '../api/index.js'

/**
 * 两端共用的 Agent 资产缓存（模型目录 + Agent 名单）。
 *
 * 为什么放在 gui-shared：桌面端（ProjectConfigDialog / GlobalConfigDialog）与移动端
 * （ProjectSettings / GlobalSettings）设置页逻辑完全一样——都是「按 kind 取模型目录、
 * 取一次名单」，复制两份必然漂移；而且两端都跑在同一个 origin 下，共享缓存让
 * 「关掉再开」「换个项目再开」都命中同一份数据。
 *
 * 语义（与 service 侧 `AgentModelCatalogCache` 对齐的 stale-while-revalidate）：
 *   - 无缓存 → 置 loading 后请求（设置页据此渲染 loading 元素）；
 *   - 有缓存且新鲜 → 直接返回，不发请求；
 *   - 有缓存但过期 → **先返回缓存**，后台静默刷新（不置 loading，控件不闪禁用）。
 *
 * 模型目录是宿主级数据（各 adapter 的模型来源与项目目录无关），故键只用 agent kind，
 * 不含 projectId：换个项目再打开设置不会重复请求。
 */

export const AGENT_ASSET_TTL_MS = 5 * 60 * 1000

export const EMPTY_AGENT_MODEL_CATALOG: AgentModelCatalog = {
  models: [],
  defaultReasoningEfforts: [],
}

type CatalogLoader = () => Promise<AgentModelCatalog>
type RosterLoader = () => Promise<AgentDescriptor[]>

const [catalogs, setCatalogs] = createSignal<Record<string, AgentModelCatalog>>({})
const [catalogLoading, setCatalogLoading] = createSignal<Record<string, boolean>>({})
const [roster, setRoster] = createSignal<AgentDescriptor[] | null>(null)
const [rosterLoading, setRosterLoading] = createSignal(false)

const catalogFetchedAt = new Map<string, number>()
const catalogInflight = new Map<string, Promise<AgentModelCatalog>>()
let rosterFetchedAt = 0
let rosterInflight: Promise<AgentDescriptor[]> | null = null

function normalizeKey(kind: string | undefined | null): string {
  return (kind ?? '').trim()
}

/** 同步窥视已缓存目录（响应式：读取它的 JSX / memo 会随缓存填充更新）。 */
export function peekAgentCatalog(kind: string | undefined | null): AgentModelCatalog | undefined {
  const key = normalizeKey(kind)
  if (!key) return undefined
  return catalogs()[key]
}

/** 同 {@link peekAgentCatalog}，但缺省返回空目录，便于直接喂给选项构造函数。 */
export function peekAgentCatalogOrEmpty(kind: string | undefined | null): AgentModelCatalog {
  return peekAgentCatalog(kind) ?? EMPTY_AGENT_MODEL_CATALOG
}

/** 是否处于「冷加载」（只有无缓存时为真；后台刷新不算）。 */
export function isAgentCatalogLoading(kind: string | undefined | null): boolean {
  const key = normalizeKey(kind)
  if (!key) return false
  return Boolean(catalogLoading()[key])
}

/**
 * 取模型目录：命中新鲜缓存直接返回；过期缓存先返回再后台刷新；无缓存才置 loading。
 * 失败时抛出（调用方决定是否静默）；后台刷新失败被吞掉，避免 unhandled rejection。
 */
export function loadAgentCatalog(
  kind: string | undefined | null,
  load: CatalogLoader,
): Promise<AgentModelCatalog> {
  const key = normalizeKey(kind)
  if (!key) return Promise.resolve(EMPTY_AGENT_MODEL_CATALOG)

  const cached = peekAgentCatalog(key)
  if (cached) {
    const fresh = Date.now() - (catalogFetchedAt.get(key) ?? 0) < AGENT_ASSET_TTL_MS
    // 过期时先给旧值，后台补一次刷新；刷新失败也不影响本次调用方。
    if (!fresh && !catalogInflight.has(key)) startCatalogFetch(key, load, false)
    return Promise.resolve(cached)
  }

  const pending = catalogInflight.get(key)
  if (pending) return pending
  return startCatalogFetch(key, load, true)
}

/** 同步窥视 Agent 名单；`null` 表示尚未取到。 */
export function peekAgentRoster(): AgentDescriptor[] | null {
  return roster()
}

export function isAgentRosterLoading(): boolean {
  return rosterLoading()
}

/** 取 Agent 名单（builtin + 全局 `customAgents`）：与模型目录同为宿主级共享数据。 */
export function loadAgentRoster(load: RosterLoader): Promise<AgentDescriptor[]> {
  const cached = roster()
  if (cached) {
    const fresh = Date.now() - rosterFetchedAt < AGENT_ASSET_TTL_MS
    if (!fresh && !rosterInflight) startRosterFetch(load, false)
    return Promise.resolve(cached)
  }
  if (rosterInflight) return rosterInflight
  return startRosterFetch(load, true)
}

function startRosterFetch(load: RosterLoader, cold: boolean): Promise<AgentDescriptor[]> {
  if (cold) setRosterLoading(true)
  const task = load()
    .then((descriptors) => {
      setRoster(descriptors)
      rosterFetchedAt = Date.now()
      return descriptors
    })
    .finally(() => {
      rosterInflight = null
      if (cold) setRosterLoading(false)
    })

  rosterInflight = task
  if (!cold) task.catch(() => undefined)
  return task
}

/** 复位全部共享缓存（单测复位 / 连接切换等场景）。 */
export function resetAgentAssetCache(): void {
  setCatalogs({})
  setCatalogLoading({})
  setRoster(null)
  setRosterLoading(false)
  catalogFetchedAt.clear()
  catalogInflight.clear()
  rosterFetchedAt = 0
  rosterInflight = null
}

function startCatalogFetch(
  key: string,
  load: CatalogLoader,
  cold: boolean,
): Promise<AgentModelCatalog> {
  if (cold) markLoading(key, true)
  const task = load()
    .then((catalog) => {
      // 空目录不入缓存：service 在 adapter 失败时也会降级空目录，缓存它会把一次性
      // 故障钉住整个 TTL。空结果照常返回，下次打开设置再试。
      if (catalog.models.length > 0) {
        setCatalogs((prev) => ({ ...prev, [key]: catalog }))
        catalogFetchedAt.set(key, Date.now())
      }
      return catalog
    })
    .finally(() => {
      catalogInflight.delete(key)
      if (cold) markLoading(key, false)
    })

  catalogInflight.set(key, task)
  if (!cold) task.catch(() => undefined)
  return task
}

function markLoading(key: string, value: boolean): void {
  setCatalogLoading((prev) => {
    if (Boolean(prev[key]) === value) return prev
    const next = { ...prev }
    if (value) next[key] = true
    else delete next[key]
    return next
  })
}
