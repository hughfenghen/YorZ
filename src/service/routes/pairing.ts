import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import type { AuthStore } from '../auth-store.js'
import { createPairingCodes, type PairingCodes } from '../pairing-codes.js'

/**
 * 配对握手路由，挂载在 `/api` 下：
 * - `GET  /pairing/code`：已授权端（持主令牌，经鉴权中间件放行）签发一次性短码。
 * - `POST /pairing/claim`：**放行清单内**（无需令牌），校验短码后签发设备令牌。
 *
 * 设备令牌 = `randomBytes(32)` 的 base64url；服务端只存其哈希（见 auth-store）。
 */
export function createPairingRoutes(
  authStore: AuthStore,
  codes: PairingCodes = createPairingCodes(),
): Hono {
  const app = new Hono()

  app.get('/pairing/code', (c) => {
    const { code, expiresAt } = codes.issue()
    return c.json({ code, expiresAt })
  })

  app.post('/pairing/claim', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const code =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>).code : undefined
    if (typeof code !== 'string' || !code.trim()) {
      return c.json({ error: 'code required' }, 400)
    }

    const result = codes.claim(code)
    if (!result.ok) {
      if (result.reason === 'locked') {
        c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)))
        return c.json({ error: 'too many attempts, try again later' }, 429)
      }
      return c.json({ error: 'invalid or expired code' }, 401)
    }

    const token = randomBytes(32).toString('base64url')
    const label = (c.req.header('user-agent') ?? 'device').slice(0, 120)
    await authStore.addDevice(token, label)
    return c.json({ token })
  })

  return app
}
