import { Hono } from 'hono'
import type { SystemNotificationCenter } from '../system-notifications.js'

export function createSystemNotificationsRoutes(center: SystemNotificationCenter): Hono {
  const app = new Hono()

  app.get('/system-notifications', (c) => c.json(center.list()))

  app.delete('/system-notifications/:id', (c) => {
    const ok = center.delete(c.req.param('id'))
    if (!ok) return c.json({ error: 'notification not found' }, 404)
    return c.json({ ok: true })
  })

  app.post('/system-notifications/:id/update', async (c) => {
    try {
      const notification = await center.update(c.req.param('id'))
      return c.json(notification)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = message === 'notification not found' ? 404 : 400
      return c.json({ error: message }, status)
    }
  })

  app.post('/system-notifications/:id/restart', async (c) => {
    try {
      const notification = await center.restart(c.req.param('id'))
      return c.json(notification)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status = message === 'notification not found' ? 404 : 400
      return c.json({ error: message }, status)
    }
  })

  return app
}
