import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  EventsHub,
  HEARTBEAT_INTERVAL_MS,
  attachHeartbeat,
  type ResolveProject,
} from '../events-hub.js'
import type { ProjectRegistry } from '../project-registry.js'
import type { RegistryEventBus } from '../registry-events.js'
import type { SystemNotificationCenter } from '../system-notifications.js'

export { HEARTBEAT_INTERVAL_MS, attachHeartbeat }
export type { ResolveProject }

// All realtime events (project list, spec list, spec detail + agent output, git
// changes, individual run) flow through ONE multiplexed SSE per browser tab.
// The client opens `/api/events/stream?clientId=<uuid>` once and POSTs
// `/api/events/subscribe` to declare which topics it wants. Topic strings:
//
//   projects
//   project:<pid>:specs
//   project:<pid>:sessions                (run status of every session)
//   project:<pid>:spec:<specId>
//   project:<pid>:spec:<specId>:changes
//   project:<pid>:session:<sid>
//   project:<pid>:commands                (running-command list)
//   project:<pid>:command:<runId>         (one run: stdout tail + status)
//
// Wire frames:
//   event: ready            data: { clientId }                 (once, on connect)
//   event: server-heartbeat data: { ts }                       (every 5s)
//   event: msg              data: { topic, event, data }       (topic payload)
//
// Motivation: browsers cap same-origin HTTP/1.1 connections at 6. Before this
// change, opening ~5 tabs / opening several review/spec pages saturated the
// budget and left later `fetch` calls perpetually pending. One SSE per tab
// keeps the budget wide open.
export function createEventsRoutes(
  resolveProject: ResolveProject,
  registry?: ProjectRegistry,
  projectsBus?: RegistryEventBus,
  systemNotifications?: SystemNotificationCenter,
): Hono {
  const app = new Hono()
  const hub = new EventsHub({ resolveProject, registry, projectsBus, systemNotifications })

  app.get('/events/stream', (c) => {
    const clientId = c.req.query('clientId')?.trim()
    if (!clientId) {
      return c.json({ error: 'clientId query parameter required' }, 400)
    }
    return streamSSE(c, async (stream) => {
      hub.attachStream(clientId, stream)
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ clientId }) })
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          hub.detach(clientId)
          resolve()
        })
      })
    })
  })

  app.post('/events/subscribe', async (c) => {
    let body: { clientId?: string; topics?: string[] }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const clientId = body.clientId?.trim()
    if (!clientId) return c.json({ error: 'clientId required' }, 400)
    const topics = Array.isArray(body.topics) ? body.topics.filter((t) => typeof t === 'string') : []
    const result = await hub.syncTopics(clientId, topics)
    return c.json(result)
  })

  return app
}
