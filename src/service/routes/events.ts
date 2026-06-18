import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { SpecWatcher } from '../watcher.js'
import type { SpecStore } from '../spec-store.js'
import type { AgentRunner, AgentRunHandle } from '../agent.js'

interface Deps {
  store: SpecStore
  watcher: SpecWatcher
  runner: AgentRunner
}

interface SseEvent {
  event: string
  data: string
}

export function createEventsRoutes(deps: Deps): Hono {
  const app = new Hono()

  // Use a distinct path (not /specs/events) to avoid colliding with the
  // dynamic /specs/:id/events route in Hono's router.
  app.get('/events/specs', (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'ready', data: '{}' })

      const queue: SseEvent[] = []
      let resolve: (() => void) | null = null
      let closed = false
      const nudge = () => {
        resolve?.()
        resolve = null
      }

      const unsub = deps.watcher.subscribeList(() => {
        queue.push({ event: 'list-updated', data: '{}' })
        nudge()
      })

      stream.onAbort(() => {
        closed = true
        unsub()
        nudge()
      })

      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolve = r
          })
          continue
        }
        const payload = queue.shift()!
        await stream.writeSSE(payload)
      }
    })
  })

  app.get('/specs/:id/events', (c) => {
    const id = c.req.param('id')
    return streamSSE(c, async (stream) => {
      const exists = await deps.store.read(id)
      if (!exists) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'spec not found' }),
        })
        return
      }
      await stream.writeSSE({
        event: 'ready',
        data: JSON.stringify({ id, mtime: exists.mtime }),
      })

      const queue: SseEvent[] = []
      let resolve: (() => void) | null = null
      let closed = false
      const nudge = () => {
        resolve?.()
        resolve = null
      }

      const unsubFile = deps.watcher.subscribe(id, (kind, mtime) => {
        queue.push({ event: 'updated', data: JSON.stringify({ type: kind, mtime }) })
        nudge()
      })

      const agentUnsubs: Array<() => void> = []
      const attachAgent = (handle: AgentRunHandle) => {
        const buf = handle.buffer()
        if (buf) {
          queue.push({
            event: 'agent-stdout',
            data: JSON.stringify({
              runId: handle.id,
              mode: handle.mode,
              specId: handle.specId,
              chunk: buf,
            }),
          })
        }
        const u1 = handle.onStdout((chunk) => {
          queue.push({
            event: 'agent-stdout',
            data: JSON.stringify({
              runId: handle.id,
              mode: handle.mode,
              specId: handle.specId,
              chunk,
            }),
          })
          nudge()
        })
        const u2 = handle.onError((message) => {
          queue.push({
            event: 'agent-error',
            data: JSON.stringify({
              runId: handle.id,
              mode: handle.mode,
              specId: handle.specId,
              message,
            }),
          })
          nudge()
        })
        const u3 = handle.onExit((code) => {
          queue.push({
            event: 'agent-exit',
            data: JSON.stringify({
              runId: handle.id,
              mode: handle.mode,
              specId: handle.specId,
              code,
            }),
          })
          nudge()
        })
        agentUnsubs.push(u1, u2, u3)
      }

      for (const h of deps.runner.active(id)) attachAgent(h)
      const unsubAgent = deps.runner.subscribe(id, attachAgent)

      stream.onAbort(() => {
        closed = true
        unsubFile()
        unsubAgent()
        for (const u of agentUnsubs) u()
        nudge()
      })

      nudge()
      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolve = r
          })
          continue
        }
        const payload = queue.shift()!
        await stream.writeSSE(payload)
      }
    })
  })

  app.get('/runs', (c) => {
    return c.json(deps.runner.listActive())
  })

  app.post('/runs/:runId/cancel', (c) => {
    const ok = deps.runner.cancel(c.req.param('runId'))
    return c.json({ ok }, ok ? 200 : 404)
  })

  app.get('/runs/:runId/events', (c) => {
    const runId = c.req.param('runId')
    return streamSSE(c, async (stream) => {
      const handle = deps.runner.get(runId)
      if (!handle) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'run not found or already ended' }),
        })
        return
      }
      await stream.writeSSE({
        event: 'ready',
        data: JSON.stringify({ runId, mode: handle.mode, specId: handle.specId }),
      })

      const queue: SseEvent[] = []
      let resolve: (() => void) | null = null
      let closed = false
      const nudge = () => {
        resolve?.()
        resolve = null
      }

      const buf = handle.buffer()
      if (buf) {
        queue.push({
          event: 'agent-stdout',
          data: JSON.stringify({ runId, mode: handle.mode, specId: handle.specId, chunk: buf }),
        })
      }
      const u1 = handle.onStdout((chunk) => {
        queue.push({
          event: 'agent-stdout',
          data: JSON.stringify({ runId, mode: handle.mode, specId: handle.specId, chunk }),
        })
        nudge()
      })
      const u2 = handle.onError((message) => {
        queue.push({
          event: 'agent-error',
          data: JSON.stringify({ runId, mode: handle.mode, specId: handle.specId, message }),
        })
        nudge()
      })
      const u3 = handle.onExit((code) => {
        queue.push({
          event: 'agent-exit',
          data: JSON.stringify({ runId, mode: handle.mode, specId: handle.specId, code }),
        })
        nudge()
      })

      stream.onAbort(() => {
        closed = true
        u1()
        u2()
        u3()
        nudge()
      })

      nudge()
      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolve = r
          })
          continue
        }
        const payload = queue.shift()!
        await stream.writeSSE(payload)
      }
    })
  })

  return app
}
