/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

/**
 * 移动端 PWA 的自定义 Service Worker（injectManifest 模式）。
 *
 * 为什么从 generateSW 切到这里：generateSW 只会产出一份纯缓存 SW，无法注入 `push` /
 * `notificationclick` 监听，移动端自然收不到任务完成推送。切到 injectManifest 后，
 * Workbox 的预缓存能力（`self.__WB_MANIFEST` 注入点）与我们自己的推送逻辑同处一份 SW。
 *
 * BASE 必须与 vite.gui-mobile.config.ts 的 base、static.ts 的挂载前缀、manifest 的
 * start_url/scope 保持一致（四处同步）。
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

const BASE = '/m/'

// registerType:'autoUpdate' 语义：新 SW 安装后立即接管，不给用户留「点一下才更新」的旧壳。
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// SPA 深层路由回落入口页；/api 必须走网络，否则接口会被 index.html 应答。
// 迁移自原 workbox 配置的 navigateFallback / navigateFallbackDenylist。
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${BASE}index.html`), {
    denylist: [/^\/api/],
  }),
)

interface PushPayload {
  title?: string
  body?: string
  url?: string
}

self.addEventListener('push', (event) => {
  let payload: PushPayload = {}
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    // 非 JSON 负载：退回纯文本当正文。
    payload = { body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'YorZ'
  const url = payload.url || BASE
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: `${BASE}icons/icon-192.png`,
      badge: `${BASE}icons/icon-192.png`,
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = (event.notification.data ?? {}) as { url?: string }
  const target = data.url || BASE
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(BASE) && 'focus' in client) return client.focus()
        }
        return self.clients.openWindow(target)
      }),
  )
})
