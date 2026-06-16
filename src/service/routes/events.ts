import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { SpecWatcher } from '../watcher.js'
import type { SpecStore } from '../spec-store.js'

interface Deps {
  store: SpecStore
  watcher: SpecWatcher
}

export function createEventsRoutes(deps: Deps): Hono {
  const app = new Hono()

  app.get('/specs/:id/events', (c) => {
    const id = c.req.param('id')
    return streamSSE(c, async (stream) => {
      const exists = await deps.store.read(id)
      if (!exists) {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'spec not found' }) })
        return
      }
      await stream.writeSSE({
        event: 'ready',
        data: JSON.stringify({ id, mtime: exists.mtime }),
      })

      const queue: string[] = []
      let resolve: (() => void) | null = null
      let closed = false

      const unsub = deps.watcher.subscribe(id, (kind, mtime) => {
        queue.push(JSON.stringify({ type: kind, mtime }))
        resolve?.()
        resolve = null
      })

      stream.onAbort(() => {
        closed = true
        unsub()
        resolve?.()
      })

      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolve = r
          })
          continue
        }
        const payload = queue.shift()!
        await stream.writeSSE({ event: 'updated', data: payload })
      }
    })
  })

  return app
}
