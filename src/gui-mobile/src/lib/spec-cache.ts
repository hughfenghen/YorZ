import type { SpecListItem } from '@shared/api/index.js'

/**
 * spec 列表的本地缓存：先画上次的结果，网络回来再替换。
 *
 * 与 `session-cache.ts` 同构，但多兜一层**内存**：会话列表页每次从详情页返回都会
 * 重新挂载，spec 列表若只靠网络，重挂那几百毫秒里行上没有 summary，等接口回来才多出
 * 两行——列表高度当场跳一下。内存缓存让「列表 ⇄ 详情」这段高频往返首帧即有终态数据，
 * localStorage 那层则负责 PWA 冷启（以及 iOS 把后台页面整个丢掉之后的重进）。
 *
 * 缓存只是**渲染兜底**，从不参与写路径：服务端返回一到就整份替换。
 */

const KEY_PREFIX = 'yorz.m.specs.'

/** 与移动端一屏能翻的量级同量级，避免 localStorage 无限增长。 */
const MAX_ENTRIES = 100

/** 进程内快照：页面重挂时不必再等一发网络，也不必反序列化 localStorage。 */
const memory = new Map<string, SpecListItem[]>()

const storageKey = (projectId: string) => `${KEY_PREFIX}${projectId}`

function isSpecListItem(v: unknown): v is SpecListItem {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.stage === 'string' &&
    typeof o.summary === 'string'
  )
}

/**
 * 读缓存：内存优先，回落 localStorage。任何异常（隐私模式、旧版本残留的结构、
 * 被手改坏的 JSON）一律当作"没有缓存"——缓存不值得让页面崩。
 */
export function readSpecCache(projectId: string): SpecListItem[] | null {
  const hot = memory.get(projectId)
  if (hot) return hot
  try {
    const raw = window.localStorage.getItem(storageKey(projectId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const list = parsed.filter(isSpecListItem)
    if (list.length === 0) return null
    memory.set(projectId, list)
    return list
  } catch {
    return null
  }
}

export function writeSpecCache(projectId: string, specs: SpecListItem[]): void {
  const trimmed = specs.slice(0, MAX_ENTRIES)
  memory.set(projectId, trimmed)
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(trimmed))
  } catch {
    // 隐私模式 / 配额满：写不进去只影响下次冷启，内存那层照常生效。
  }
}
