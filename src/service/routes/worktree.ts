import { Hono } from 'hono'
import { basename } from 'node:path'
import { WorktreeManager } from '../worktree-manager.js'
import type { ProjectRegistry } from '../project-registry.js'

interface CreateBody {
  specSlug?: string
  branch?: string
}

interface MergeBody {
  commitMessage?: string
}

export function createWorktreeRoutes(registry: ProjectRegistry, manager: WorktreeManager): Hono {
  const app = new Hono()

  app.post('/projects/:projectId/worktrees', async (c) => {
    const projectId = c.req.param('projectId')
    let body: CreateBody = {}
    try {
      body = (await c.req.json()) as CreateBody
    } catch {
      // empty body is acceptable when specSlug is supplied as a query string later.
    }
    const specSlug = typeof body.specSlug === 'string' ? body.specSlug.trim() : ''
    if (!specSlug) return c.json({ error: 'specSlug required' }, 400)
    const main = await registry.findEntry(projectId)
    if (!main) return c.json({ error: 'main project not found' }, 404)
    if (main.worktree) return c.json({ error: 'parent project is itself a worktree' }, 400)
    try {
      const result = await manager.createWorktree({
        mainProjectId: projectId,
        specSlug,
        branch: typeof body.branch === 'string' ? body.branch : undefined,
      })
      const entry = result.entry
      return c.json(
        {
          id: entry.id,
          name: basename(entry.path),
          path: entry.path,
          lastActivityAt: entry.lastActivityAt,
          worktree: entry.worktree,
          branch: result.branch,
          baseRef: result.baseRef,
        },
        201,
      )
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })

  app.post('/projects/:projectId/merge-main', async (c) => {
    const projectId = c.req.param('projectId')
    let body: MergeBody = {}
    try {
      body = (await c.req.json()) as MergeBody
    } catch {
      // empty body is fine; defaults will be used.
    }
    const entry = await registry.findEntry(projectId)
    if (!entry) return c.json({ error: 'project not found' }, 404)
    if (!entry.worktree) return c.json({ error: 'project is not a worktree' }, 400)
    try {
      const result = await manager.mergeBackToMain({
        worktreeProjectId: projectId,
        commitMessage: body.commitMessage,
      })
      return c.json(result, 200)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })

  return app
}
