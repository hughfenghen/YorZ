import { Hono } from 'hono'
import { basename, isAbsolute, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { ProjectRegistry } from '../project-registry.js'
import type { WorktreeManager } from '../worktree-manager.js'
import { GitError } from '../git.js'

export function createProjectRoutes(
  registry: ProjectRegistry,
  worktreeManager: WorktreeManager,
): Hono {
  const app = new Hono()

  app.get('/projects', async (c) => {
    const items = await registry.list()
    return c.json(items)
  })

  app.post('/projects', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const path = (body as { path?: unknown } | null)?.path
    if (typeof path !== 'string' || !path.trim()) {
      return c.json({ error: 'path required' }, 400)
    }
    const trimmed = path.trim()
    if (!isAbsolute(trimmed)) {
      return c.json({ error: 'path must be absolute' }, 400)
    }
    const normalized = resolve(trimmed)
    if (!existsSync(normalized)) {
      return c.json({ error: `path does not exist: ${normalized}` }, 400)
    }
    const stats = await stat(normalized)
    if (!stats.isDirectory()) {
      return c.json({ error: `path is not a directory: ${normalized}` }, 400)
    }
    try {
      const result = await registry.add(normalized)
      return c.json(
        {
          id: result.entry.id,
          name: basename(result.entry.path),
          path: result.entry.path,
          lastActivityAt: result.entry.lastActivityAt,
        },
        result.created ? 201 : 200,
      )
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })

  app.delete('/projects/:projectId', async (c) => {
    const id = c.req.param('projectId')
    const deleteFiles = c.req.query('deleteFiles') === 'true'
    if (deleteFiles) {
      const entry = await registry.findEntry(id)
      if (!entry) return c.json({ ok: false, error: 'project not found' }, 404)
      if (!entry.worktree) {
        return c.json(
          { ok: false, error: 'deleteFiles is only supported for worktree projects' },
          400,
        )
      }
      try {
        await worktreeManager.removeWorktree(id)
        return c.json({ ok: true })
      } catch (err) {
        if (err instanceof GitError && err.code === 'dirty') {
          return c.json({ ok: false, error: '存在未提交 git 的变更', dirty: true }, 409)
        }
        return c.json({ ok: false, error: (err as Error).message }, 400)
      }
    }
    const ok = await registry.remove(id)
    return c.json({ ok }, ok ? 200 : 404)
  })

  return app
}
