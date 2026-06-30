import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { GitOpsAction } from '../agent.js'
import type { ProjectInstance } from '../project-registry.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

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

  app.post('/projects/:projectId/specs/:id/review', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    const specRel = `${p.specsDirRelative}/${specId}/spec.md`
    const reviewRel = `${p.specsDirRelative}/${specId}/review.md`
    const prompt =
      `请使用 yorz-spec skill 的 "Review / Git Ops 阶段" 流程处理本次 review：\n` +
      `- spec 文档：${specRel}\n` +
      `- 输出文件：${reviewRel}（追加新二级标题条目，禁止覆盖历史）\n` +
      `- 必含 4 节：变更总结 / 影响范围 / 风险提醒 / 变更文件清单\n` +
      `- 触发时间使用本机当前时间，格式 \`YYYY-MM-DD HH:mm:ss\`\n`
    const handle = p.runner.run({ specId, mode: 'review', prompt })
    return c.json({ runId: handle.id })
  })

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
    const reviewRel = `${p.specsDirRelative}/${specId}/review.md`
    const prompt = buildGitOpsPrompt(action as GitOpsAction, specId, specRel, reviewRel)
    const handle = p.runner.run({ specId, mode: 'git-ops', prompt, action: action as GitOpsAction })
    return c.json({ runId: handle.id })
  })

  app.get('/projects/:projectId/specs/:id/review', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    const file = join(p.specsDir, specId, 'review.md')
    if (!existsSync(file)) return c.json({ text: '' })
    try {
      const text = await readFile(file, 'utf8')
      return c.json({ text })
    } catch {
      return c.json({ text: '' })
    }
  })

  return app
}

function buildGitOpsPrompt(
  action: GitOpsAction,
  specId: string,
  specRel: string,
  reviewRel: string,
): string {
  const base =
    `请使用 yorz-spec skill 的 "Review / Git Ops 阶段" 流程执行 git 操作：\n` +
    `- spec 文档：${specRel}\n` +
    `- 最近一次 review：${reviewRel}（如不存在，请先依据 git status/diff 自行判断本次 spec 关联的变更）\n` +
    `- spec-id：${specId}\n`
  switch (action) {
    case 'commit':
      return (
        base +
        `- 动作：git-commit。请基于 review 报告与 git status，由你自主判断本次 spec 相关的变更文件，执行 \`git add\` + \`git commit\`；commit message 由你生成，不带 scope；禁止 \`git push\` 与 \`git reset --hard\`。\n`
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
