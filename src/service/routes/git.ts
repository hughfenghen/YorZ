import { Hono } from 'hono'
import {
  listChanges,
  fileDiff,
  commit as gitCommit,
  discard as gitDiscard,
  listBranches,
  checkoutBranch,
  push as gitPush,
  pull as gitPull,
  GitError,
} from '../git.js'
import type { ProjectInstance } from '../project-registry.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

/**
 * Project-scoped git routes. The git working set has always been the whole
 * repository — the older spec-scoped endpoints only used the spec id as an
 * existence check — so the standalone Git page and the spec Review page share
 * these and no longer thread a spec id through git operations.
 */
export function createGitRoutes(resolveProject: ResolveProject): Hono {
  const app = new Hono()

  const need = async (c: import('hono').Context): Promise<ProjectInstance | Response> => {
    const id = c.req.param('projectId') ?? ''
    if (!id) return c.json({ error: 'projectId required' }, 400)
    const project = await resolveProject(id)
    if (!project) return c.json({ error: 'project not found' }, 404)
    return project
  }

  const readBody = async (c: import('hono').Context): Promise<Record<string, unknown> | null> => {
    try {
      const body = (await c.req.json()) as unknown
      return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    } catch {
      return null
    }
  }

  const toPaths = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

  app.get('/projects/:projectId/git/changes', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    try {
      return c.json({ changes: await listChanges(p.path) })
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.get('/projects/:projectId/git/diff', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const path = c.req.query('path') ?? ''
    if (!path) return c.json({ error: 'path required' }, 400)
    try {
      return c.json(await fileDiff(p.path, path))
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.get('/projects/:projectId/git/branches', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    try {
      return c.json(await listBranches(p.path))
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.post('/projects/:projectId/git/checkout', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const body = await readBody(c)
    if (!body) return c.json({ error: 'invalid JSON body' }, 400)
    const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
    if (!branch) return c.json({ error: 'branch must not be empty' }, 400)
    try {
      const result = await checkoutBranch(p.path, branch)
      return c.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.post('/projects/:projectId/git/commit', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const body = await readBody(c)
    if (!body) return c.json({ error: 'invalid JSON body' }, 400)
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const paths = toPaths(body.paths)
    if (!message) return c.json({ error: 'message must not be empty' }, 400)
    if (paths.length === 0) return c.json({ error: 'paths must not be empty' }, 400)
    try {
      return c.json(await gitCommit(p.path, { message, paths }))
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.post('/projects/:projectId/git/discard', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const body = await readBody(c)
    if (!body) return c.json({ error: 'invalid JSON body' }, 400)
    const paths = toPaths(body.paths)
    if (paths.length === 0) return c.json({ error: 'paths must not be empty' }, 400)
    try {
      await gitDiscard(p.path, { paths })
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.post('/projects/:projectId/git/push', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    try {
      const result = await gitPush(p.path)
      return c.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.post('/projects/:projectId/git/pull', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    try {
      const result = await gitPull(p.path)
      return c.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  return app
}
