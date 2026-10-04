import { Hono } from 'hono'
import { createPushStore, type PushStore, type PushSubscriptionJSON } from '../push-store.js'

/**
 * Web Push 订阅相关路由，挂载在 `/api` 下：
 * - `GET  /push/vapid-public-key`：下发 VAPID 公钥，供浏览器 `pushManager.subscribe` 用。
 * - `POST /push/subscriptions`：保存浏览器 `PushSubscription`（按 endpoint 去重）。
 * - `DELETE /push/subscriptions`：按 endpoint 退订。
 */
export function createPushRoutes(
  globalConfigPath?: string,
  store: PushStore = createPushStore(globalConfigPath),
): Hono {
  const app = new Hono()

  app.get('/push/vapid-public-key', async (c) => {
    const publicKey = await store.getVapidPublicKey()
    return c.json({ publicKey })
  })

  app.post('/push/subscriptions', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const sub = parseSubscription(raw)
    if (!sub) return c.json({ error: 'invalid subscription' }, 400)
    await store.addSubscription(sub)
    return c.json({ ok: true })
  })

  app.delete('/push/subscriptions', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const endpoint =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>).endpoint : undefined
    if (typeof endpoint !== 'string' || !endpoint) {
      return c.json({ error: 'endpoint required' }, 400)
    }
    const removed = await store.removeSubscription(endpoint)
    return c.json({ ok: true, removed })
  })

  return app
}

function parseSubscription(value: unknown): PushSubscriptionJSON | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (typeof obj.endpoint !== 'string' || !obj.endpoint) return null
  const keys = obj.keys
  if (!keys || typeof keys !== 'object') return null
  const k = keys as Record<string, unknown>
  if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return null
  const sub: PushSubscriptionJSON = {
    endpoint: obj.endpoint,
    keys: { p256dh: k.p256dh, auth: k.auth },
  }
  if (typeof obj.expirationTime === 'number' || obj.expirationTime === null) {
    sub.expirationTime = obj.expirationTime as number | null
  }
  return sub
}
