import type { SessionInfo } from '@shared/api/index.js'

/**
 * 会话列表的本地缓存：进列表先画上次的结果，网络回来再替换。
 *
 * PWA 冷启（以及 iOS 把后台页面整个丢掉之后的重进）每次都要空等一发网络，
 * 而会话列表几乎总是"和上次差不多"——先画缓存能把这段白屏抹掉。
 * 缓存只是**渲染兜底**，从不参与任何写路径：服务端返回一到就整份替换。
 */

const KEY_PREFIX = 'yorz.m.sessions.'

/** 与服务端列表上限同量级，避免 localStorage 无限增长。 */
const MAX_ENTRIES = 30

const storageKey = (projectId: string) => `${KEY_PREFIX}${projectId}`

function isSessionInfo(v: unknown): v is SessionInfo {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.kind === 'string' &&
    typeof o.createdAt === 'number' &&
    typeof o.updatedAt === 'number'
  )
}

/**
 * 读缓存。任何异常（隐私模式、旧版本残留的结构、被手改坏的 JSON）
 * 一律当作"没有缓存"——缓存不值得让页面崩。
 */
export function readSessionCache(projectId: string): SessionInfo[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const list = parsed.filter(isSessionInfo)
    return list.length > 0 ? list : null
  } catch {
    return null
  }
}

/**
 * 写缓存。`running` 一律落成 false：它是瞬时状态，持久化会让下次冷启
 * 闪出一排假的「运行中」圆点，而真值几百毫秒后就由列表接口纠正。
 */
export function writeSessionCache(projectId: string, sessions: SessionInfo[]): void {
  try {
    const trimmed = sessions.slice(0, MAX_ENTRIES).map(({ running: _running, ...rest }) => rest)
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(trimmed))
  } catch {
    // 隐私模式 / 配额满：缓存写不进去不影响本次渲染。
  }
}
