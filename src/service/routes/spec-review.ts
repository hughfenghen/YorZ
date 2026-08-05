import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import {
  listChanges,
  commit as gitCommit,
  discard as gitDiscard,
  stash as gitStash,
  GitError,
} from '../git.js'
import type { ProjectInstance } from '../project-registry.js'
import { skillRef } from '../skill-ref.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

export type GitOpsAction = 'commit' | 'discard' | 'stash'

const VALID_ACTIONS: ReadonlySet<GitOpsAction> = new Set(['commit', 'discard', 'stash'])

export function createSpecReviewRoutes(resolveProject: ResolveProject): Hono {
  const app = new Hono()

  const need = async (c: import('hono').Context): Promise<ProjectInstance | Response> => {
    const id = c.req.param('projectId') ?? ''
    if (!id) return c.json({ error: 'projectId required' }, 400)
    const project = await resolveProject(id)
    if (!project) return c.json({ error: 'project not found' }, 404)
    return project
  }

  app.post('/projects/:projectId/specs/:id/git', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const action = (
      body && typeof body === 'object' ? (body as { action?: unknown }).action : null
    ) as GitOpsAction | null | undefined
    if (!action || typeof action !== 'string' || !VALID_ACTIONS.has(action as GitOpsAction)) {
      return c.json({ error: 'action must be one of commit | discard | stash' }, 400)
    }
    const specRel = `${p.specsDirRelative}/${specId}/spec.md`
    const prompt = buildGitOpsPrompt(action as GitOpsAction, specId, specRel)
    const { sessionId } = await p.sessions.ensureSessionForSpec(specId)
    const handle = await p.sessions.send(sessionId, prompt)
    return c.json({ runId: handle.runId, sessionId })
  })

  app.get('/projects/:projectId/specs/:id/debug', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    const file = join(p.specsDir, specId, 'debug.md')
    if (!existsSync(file)) return c.json({ exists: false, text: '' })
    try {
      const text = await readFile(file, 'utf8')
      return c.json({ exists: true, text })
    } catch {
      return c.json({ exists: false, text: '' })
    }
  })

  app.get('/projects/:projectId/specs/:id/changes', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    try {
      const changes = await listChanges(p.path)
      return c.json({ changes })
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.post('/projects/:projectId/specs/:id/commit', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const obj =
      body && typeof body === 'object' ? (body as { message?: unknown; paths?: unknown }) : {}
    const message = typeof obj.message === 'string' ? obj.message.trim() : ''
    const paths = Array.isArray(obj.paths)
      ? (obj.paths as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    if (!message) return c.json({ error: 'message must not be empty' }, 400)
    if (paths.length === 0) return c.json({ error: 'paths must not be empty' }, 400)
    try {
      const result = await gitCommit(p.path, { message, paths })
      return c.json(result)
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.post('/projects/:projectId/specs/:id/discard', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const obj = body && typeof body === 'object' ? (body as { paths?: unknown }) : {}
    const paths = Array.isArray(obj.paths)
      ? (obj.paths as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    if (paths.length === 0) return c.json({ error: 'paths must not be empty' }, 400)
    try {
      await gitDiscard(p.path, { paths })
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  app.post('/projects/:projectId/specs/:id/stash', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const obj =
      body && typeof body === 'object' ? (body as { message?: unknown; paths?: unknown }) : {}
    const message = typeof obj.message === 'string' ? obj.message.trim() : ''
    const paths = Array.isArray(obj.paths)
      ? (obj.paths as unknown[]).filter((v): v is string => typeof v === 'string')
      : []
    if (paths.length === 0) return c.json({ error: 'paths must not be empty' }, 400)
    try {
      await gitStash(p.path, { message: message || `yorz:${specId}`, paths })
      return c.json({ ok: true })
    } catch (err) {
      if (err instanceof GitError) return c.json({ error: err.message }, 400)
      throw err
    }
  })

  return app
}

function buildGitOpsPrompt(action: GitOpsAction, specId: string, specRel: string): string {
  const base =
    `${skillRef('yorz-git-ops')}，然后执行 git 操作：\n` +
    `- spec 文档：${specRel}\n` +
    `- 请依据 spec 文档与 git status/diff 自行判断本次 spec 关联的变更文件\n` +
    `- spec-id：${specId}\n`
  switch (action) {
    case 'commit':
      return (
        base +
        `- 动作：git-commit。请基于 spec 文档与 git status/diff，由你自主判断本次 spec 相关的变更文件，执行 \`git add\` + \`git commit\`；commit message 由你生成，不带 scope；禁止 \`git push\` 与 \`git reset --hard\`。\n`
      )
    case 'discard':
      return (
        base +
        `- 动作：git-discard。请使用 \`git restore --staged --worktree -- <paths>\` 与 \`git clean -fd -- <paths>\` 丢弃 spec 相关的未提交变更；对 untracked 新文件应先在终端输出列表再处理；不要预先 stash 备份；禁止 \`git reset --hard\` 与 \`git push\`。\n`
      )
    case 'stash':
      return (
        base +
        `- 动作：git-stash。请使用 \`git stash push -m "yorz:${specId}" -- <paths>\` 暂存 spec 相关变更文件；禁止 \`git push\`。\n`
      )
  }
}
