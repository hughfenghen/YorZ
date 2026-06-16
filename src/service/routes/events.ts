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

  return app
}
