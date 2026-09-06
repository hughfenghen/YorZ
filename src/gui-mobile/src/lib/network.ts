import { createSignal, onCleanup } from 'solid-js'

/**
 * 在线/离线状态。移动端网络会频繁抖动，界面需要能明确告诉用户「现在看到的是缓存」，
 * 否则离线时的空列表会被读成「数据没了」。
 *
 * navigator.onLine 只反映「有没有网络接口」，不保证真能连上服务端；
 * 真正的可达性判断等接入 API 层后再由请求失败来兜底。
 */
const [online, setOnline] = createSignal(typeof navigator === 'undefined' ? true : navigator.onLine)

export { online }

/** 在根组件挂载时调用；返回的清理由 Solid 的 onCleanup 接管。 */
export function watchNetwork(): void {
  if (typeof window === 'undefined') return
  const goOnline = () => setOnline(true)
  const goOffline = () => setOnline(false)
  window.addEventListener('online', goOnline)
  window.addEventListener('offline', goOffline)
  onCleanup(() => {
    window.removeEventListener('online', goOnline)
    window.removeEventListener('offline', goOffline)
  })
}
