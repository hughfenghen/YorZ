import { Hono } from 'hono'
import { SpecStore, type SpecType } from '../spec-store.js'

interface Deps {
  store: SpecStore
}

export function createSpecsRoutes(deps: Deps): Hono {
  const app = new Hono()

  app.get('/specs', async (c) => {
    const items = await deps.store.list()
    return c.json(items)
  })

  app.post('/specs', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const input = parseCreateBody(body)
    if ('error' in input) return c.json({ error: input.error }, 400)
    try {
      const { id, path } = await deps.store.create(input)
      return c.json({ id, path }, 201)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })

  app.get('/specs/:id', async (c) => {
    const detail = await deps.store.read(c.req.param('id'))
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    return c.json(detail)
  })

  app.post('/specs/:id/inputs', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    if (
      !body ||
      typeof body !== 'object' ||
      (body as { kind?: unknown }).kind !== 'append-note' ||
      typeof (body as { content?: unknown }).content !== 'string'
    ) {
      return c.json({ error: 'expected { kind: "append-note", content: string }' }, 400)
    }
    try {
      await deps.store.appendNote(c.req.param('id'), (body as { content: string }).content)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404)
    }
  })

  return app
}

type CreateInput = {
  title: string
  type: SpecType
  summary: string
  requirement?: string
}

function parseCreateBody(body: unknown): CreateInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' }
  const obj = body as Record<string, unknown>
  if (typeof obj.title !== 'string' || !obj.title.trim()) return { error: 'title required' }
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) return { error: 'summary required' }
  const rawType = (obj.type as string | undefined) ?? 'feat'
  if (rawType !== 'feat' && rawType !== 'refct' && rawType !== 'fix') {
    return { error: 'type must be feat | refct | fix' }
  }
  const out: CreateInput = {
    title: obj.title,
    summary: obj.summary,
    type: rawType,
  }
  if (typeof obj.requirement === 'string' && obj.requirement.trim()) {
    out.requirement = obj.requirement
  }
  return out
}
