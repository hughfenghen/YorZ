import { Hono } from 'hono'
import type { ProjectInstance } from '../project-registry.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

const READ_MAX_BYTES = 256 * 1024

export function createAgentLogsRoutes(resolveProject: ResolveProject): Hono {
  const app = new Hono()

  const need = async (c: import('hono').Context): Promise<ProjectInstance | Response> => {
    const id = c.req.param('projectId') ?? ''
    if (!id) return c.json({ error: 'projectId required' }, 400)
    const project = await resolveProject(id)
    if (!project) return c.json({ error: 'project not found' }, 404)
    return project
  }

  app.get('/projects/:projectId/specs/:id/agent-logs', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const metas = await p.agentLogs.listBySpec(specId)
    return c.json(metas)
  })

  app.get('/projects/:projectId/specs/:id/agent-logs/:runId', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const runId = c.req.param('runId')
    const metas = await p.agentLogs.listBySpec(specId)
    const meta = metas.find((m) => m.runId === runId)
    if (!meta) return c.json({ error: 'run not found' }, 404)
    const { content, truncated } = await p.agentLogs.readLog(specId, runId, {
      maxBytes: READ_MAX_BYTES,
    })
    return c.json({ meta, content, truncated })
  })

  return app
}
