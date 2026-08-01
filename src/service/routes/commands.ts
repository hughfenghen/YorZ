import { Hono } from 'hono'
import { CommandNotFoundError, RunNotFoundError } from '../command-manager.js'
import type { ProjectInstance } from '../project-registry.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

const MAX_NAME_LEN = 120
const MAX_CLI_LEN = 2000

export function createCommandsRoutes(resolveProject: ResolveProject): Hono {
  const app = new Hono()

  const need = async (c: import('hono').Context): Promise<ProjectInstance | Response> => {
    const id = c.req.param('projectId') ?? ''
    if (!id) return c.json({ error: 'projectId required' }, 400)
    const project = await resolveProject(id)
    if (!project) return c.json({ error: 'project not found' }, 404)
    return project
  }

  // ---- definitions ----

  app.get('/projects/:projectId/commands', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    return c.json(await p.commands.listDefs())
  })

  app.post('/projects/:projectId/commands', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const parsed = parseDefBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    const def = await p.commands.addDef(parsed.name, parsed.cli)
    return c.json(def, 201)
  })

  app.delete('/projects/:projectId/commands/:commandId', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const ok = await p.commands.removeDef(c.req.param('commandId'))
    if (!ok) return c.json({ error: 'command not found' }, 404)
    return c.json({ ok: true })
  })

  // ---- runs ----

  app.get('/projects/:projectId/command-runs', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    return c.json(await p.commands.listRuns())
  })

  app.post('/projects/:projectId/command-runs', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const commandId =
      body && typeof body === 'object' ? (body as Record<string, unknown>).commandId : undefined
    if (typeof commandId !== 'string' || !commandId.trim()) {
      return c.json({ error: 'commandId required' }, 400)
    }
    try {
      const run = await p.commands.run(commandId.trim())
      return c.json(run, 201)
    } catch (err) {
      if (err instanceof CommandNotFoundError) return c.json({ error: 'command not found' }, 404)
      return c.json({ error: (err as Error).message }, 400)
    }
  })

  app.get('/projects/:projectId/command-runs/:runId', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const run = await p.commands.getRun(c.req.param('runId'))
    if (!run) return c.json({ error: 'command run not found' }, 404)
    return c.json(run)
  })

  app.get('/projects/:projectId/command-runs/:runId/output', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const raw = c.req.query('offset')
    let offset: number | undefined
    if (raw !== undefined && raw !== '') {
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0)
        return c.json({ error: 'offset must be a non-negative integer' }, 400)
      offset = n
    }
    try {
      return c.json(await p.commands.readOutput(c.req.param('runId'), offset))
    } catch (err) {
      if (err instanceof RunNotFoundError) return c.json({ error: 'command run not found' }, 404)
      throw err
    }
  })

  app.post('/projects/:projectId/command-runs/:runId/stop', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    try {
      const run = await p.commands.stop(c.req.param('runId'))
      return c.json({ ok: true, run })
    } catch (err) {
      if (err instanceof RunNotFoundError) return c.json({ error: 'command run not found' }, 404)
      throw err
    }
  })

  app.delete('/projects/:projectId/command-runs/:runId', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const ok = await p.commands.clear(c.req.param('runId'))
    if (!ok) return c.json({ error: 'command run not found' }, 404)
    return c.json({ ok: true })
  })

  return app
}

function parseDefBody(value: unknown): { name: string; cli: string } | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'body must be an object' }
  const obj = value as Record<string, unknown>
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  const cli = typeof obj.cli === 'string' ? obj.cli.trim() : ''
  if (!name) return { error: 'name required' }
  if (name.length > MAX_NAME_LEN) return { error: `name too long (max ${MAX_NAME_LEN})` }
  if (!cli) return { error: 'cli required' }
  if (cli.length > MAX_CLI_LEN) return { error: `cli too long (max ${MAX_CLI_LEN})` }
  return { name, cli }
}
