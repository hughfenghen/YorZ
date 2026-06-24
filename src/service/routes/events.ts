import { Hono } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { AgentRunHandle } from '../agent.js'
import type { ProjectInstance, ProjectRegistry } from '../project-registry.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

interface SseEvent {
  event: string
  data: string
}

export const HEARTBEAT_INTERVAL_MS = 5000

// Periodically writes a `: keep-alive` SSE comment (for reverse-proxy idle
// timeouts) plus a `server-heartbeat` named event (for the GUI watchdog to
// refresh its lastEventAt). Returns a cleanup function that clears the timer.
export function attachHeartbeat(
  stream: SSEStreamingApi,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        await stream.write(': keep-alive\n\n')
        await stream.writeSSE({
          event: 'server-heartbeat',
          data: JSON.stringify({ ts: Date.now() }),
        })
      } catch {
        // stream may have closed between writes; onAbort cleanup handles it
      }
    })()
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

export function createEventsRoutes(
  resolveProject: ResolveProject,
  _registry?: ProjectRegistry,
): Hono {
  const app = new Hono()

  // Use a distinct path (not /specs/events) to avoid colliding with the
  // dynamic /specs/:id/events route in Hono's router.
  app.get('/projects/:projectId/events/specs', (c) => {
    const projectId = c.req.param('projectId')
    return streamSSE(c, async (stream) => {
      const project = await resolveProject(projectId)
      if (!project) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'project not found' }),
        })
        return
      }
      await stream.writeSSE({ event: 'ready', data: '{}' })
      const stopHeartbeat = attachHeartbeat(stream)

      const queue: SseEvent[] = []
      let resolve: (() => void) | null = null
      let closed = false
      const nudge = () => {
        resolve?.()
        resolve = null
      }

      const unsub = project.watcher.subscribeList(() => {
        queue.push({ event: 'list-updated', data: '{}' })
        nudge()
      })

      stream.onAbort(() => {
        closed = true
        stopHeartbeat()
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

  app.get('/projects/:projectId/specs/:id/events', (c) => {
    const projectId = c.req.param('projectId')
    const id = c.req.param('id')
    return streamSSE(c, async (stream) => {
      const project = await resolveProject(projectId)
      if (!project) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'project not found' }),
        })
        return
      }
      const exists = await project.store.read(id)
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
      const stopHeartbeat = attachHeartbeat(stream)

      const queue: SseEvent[] = []
      let resolve: (() => void) | null = null
      let closed = false
      const nudge = () => {
        resolve?.()
        resolve = null
      }

      const unsubFile = project.watcher.subscribe(id, (kind, mtime) => {
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

      for (const h of project.runner.active(id)) attachAgent(h)
      const unsubAgent = project.runner.subscribe(id, attachAgent)

      stream.onAbort(() => {
        closed = true
        stopHeartbeat()
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

  app.get('/projects/:projectId/runs', async (c) => {
    const project = await resolveProject(c.req.param('projectId'))
    if (!project) return c.json({ error: 'project not found' }, 404)
    return c.json(project.runner.listActive())
  })

  app.post('/projects/:projectId/runs/:runId/cancel', async (c) => {
    const project = await resolveProject(c.req.param('projectId'))
    if (!project) return c.json({ error: 'project not found' }, 404)
    const ok = project.runner.cancel(c.req.param('runId'))
    return c.json({ ok }, ok ? 200 : 404)
  })

  app.get('/projects/:projectId/runs/:runId/events', (c) => {
    const projectId = c.req.param('projectId')
    const runId = c.req.param('runId')
    return streamSSE(c, async (stream) => {
      const project = await resolveProject(projectId)
      if (!project) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'project not found' }),
        })
        return
      }
      const handle = project.runner.get(runId)
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
      const stopHeartbeat = attachHeartbeat(stream)

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
        stopHeartbeat()
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
