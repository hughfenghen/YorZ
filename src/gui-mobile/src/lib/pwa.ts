import { createSignal } from 'solid-js'
import { registerSW } from 'virtual:pwa-register'
import { api, type PushSubscriptionPayload } from '@shared/api/index.js'

/**
 * Service Worker 注册与离线状态。
 *
 * `virtual:pwa-register` 是 vite-plugin-pwa 注入的虚拟模块，生产构建里指向真正生成的
 * sw.js；开发期因为 devOptions.enabled 也会有一份，方便在真机上验证安装流程。
 * 注册动作放在这里而不是让插件自动注入 <script>，是为了能拿到回调、把状态接进 Solid 信号。
 */

const [offlineReady, setOfflineReady] = createSignal(false)
const [needRefresh, setNeedRefresh] = createSignal(false)

export { offlineReady, needRefresh }

/**
 * 触发一次立即更新。registerType 是 autoUpdate，正常情况下新 SW 会自己接管，
 * 这个函数留给「用户手动点刷新」的入口，以及 autoUpdate 因页面长期不卸载而迟迟不生效的情况。
 */
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null

export function applyUpdate(): void {
  void updateSW?.(true)
}

let registered = false

function hslTokenToHex(token: string): string | null {
  const match = token.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/)
  if (!match) return null
  const h = Number(match[1])
  const s = Number(match[2]) / 100
  const l = Number(match[3]) / 100
  if (![h, s, l].every(Number.isFinite)) return null

  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    const value = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

function syncThemeColorMeta(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const root = document.documentElement
  const background = window.getComputedStyle(root).getPropertyValue('--background').trim()
  const color = hslTokenToHex(background) ?? '#f2f2e9'

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.append(meta)
  }
  meta.content = color
}

function initThemeColorSync(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const sync = () => window.requestAnimationFrame(syncThemeColorMeta)
  sync()

  const observer = new window.MutationObserver(sync)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-kb-theme', 'data-kb-theme-name'],
  })
}

/** 在应用入口调用一次。SSR/测试环境下没有 navigator.serviceWorker，直接跳过。 */
export function initPWA(): void {
  if (registered) return
  registered = true
  initThemeColorSync()
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      setOfflineReady(true)
    },
    onNeedRefresh() {
      setNeedRefresh(true)
    },
    onRegisterError(error) {
      // 注册失败不该影响页面可用性——PWA 只是增强，在线路径照常走网络。
      console.error('[pwa] service worker 注册失败', error)
    },
  })
}

/**
 * 是否具备 Web Push 能力。
 *
 * 推送要求**安全上下文**（HTTPS 或 localhost）+ ServiceWorker + PushManager + Notification。
 * 手机经局域网 IP 以 HTTP 访问 `/m/` 时 `isSecureContext` 为 false，这里会返回 false，
 * 设置页据此禁用开关并给降级提示——这是 HTTP 下推送不可达的根本原因，非代码能绕过。
 */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!window.isSecureContext) return false
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** VAPID 公钥是 Base64URL 字符串，subscribe 需要 Uint8Array 形式的 applicationServerKey。 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  // 显式用 ArrayBuffer 作底，避免 lib.dom 把 Uint8Array 推断成 ArrayBufferLike（含
  // SharedArrayBuffer）而与 applicationServerKey 的 BufferSource 类型不兼容。
  const output = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

/** 当前是否已存在有效订阅（设置页初始化开关态用）。 */
export async function hasPushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false
  const reg = await navigator.serviceWorker.ready
  return (await reg.pushManager.getSubscription()) !== null
}

/**
 * 开启推送：请求通知授权 → 取 VAPID 公钥 → `pushManager.subscribe` → 上报订阅。
 * 失败以带标识的 Error 抛出（`push-unsupported` / `permission-denied`），由调用方映射文案。
 */
export async function enablePush(): Promise<void> {
  if (!isPushSupported()) throw new Error('push-unsupported')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission-denied')
  const { publicKey } = await api.getVapidPublicKey()
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }))
  await api.savePushSubscription(sub.toJSON() as PushSubscriptionPayload)
}

/** 关闭推送：取消浏览器订阅并通知服务端退订。best-effort，不因任一步失败而中断另一步。 */
export async function disablePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  try {
    await sub.unsubscribe()
  } finally {
    await api.deletePushSubscription(endpoint).catch(() => {})
  }
}

/**
 * 当前是否运行在「已安装」的独立窗口里（主屏图标启动 / Android WebAPK）。
 * iOS 走的是私有的 navigator.standalone，两边都要看。
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone === true
}
