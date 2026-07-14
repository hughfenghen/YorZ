import { Hono } from 'hono'
import type { AgentKind } from '../agent-sdk/types.js'
import type { ProjectInstance } from '../project-registry.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

const KINDS: AgentKind[] = ['claude', 'codex', 'opencode']

export function createSessionsRoutes(resolveProject: ResolveProject): Hono {
  const app = new Hono()

  const need = async (c: import('hono').Context): Promise<ProjectInstance | Response> => {
    const id = c.req.param('projectId') ?? ''
    if (!id) return c.json({ error: 'projectId required' }, 400)
    const project = await resolveProject(id)
    if (!project) return c.json({ error: 'project not found' }, 404)
    return project
  }

  app.get('/projects/:projectId/sessions', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    return c.json(await p.sessions.listSessions())
  })

  app.post('/projects/:projectId/sessions', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    let body: { title?: unknown; agentKind?: unknown } = {}
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      // empty body is allowed
    }
    const kind = KINDS.includes(body.agentKind as AgentKind)
      ? (body.agentKind as AgentKind)
      : undefined
    const title = typeof body.title === 'string' ? body.title : undefined
    try {
      const created = await p.sessions.createSession(kind, title)
      return c.json(created, 201)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  app.get('/projects/:projectId/specs/:id/session', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    try {
      // Read-only probe: never mint a session here. Opening a spec detail page
      // must not create a session that would never run a turn.
      const found = await p.sessions.findSessionForSpec(specId)
      return c.json(found ?? { sessionId: null, kind: null })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  app.get('/projects/:projectId/sessions/:sid/messages', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    try {
      return c.json(await p.sessions.getMessages(c.req.param('sid')))
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  app.post('/projects/:projectId/sessions/:sid/messages', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    let body: { prompt?: unknown } = {}
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt) return c.json({ error: 'prompt required' }, 400)
    const handle = p.sessions.send(c.req.param('sid'), prompt)
    return c.json({ runId: handle.runId, sessionId: handle.sessionId }, 202)
  })

  app.post('/projects/:projectId/sessions/:sid/abort', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const ok = await p.sessions.abort(c.req.param('sid'))
    return c.json({ aborted: ok })
  })

  return app
}
