import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Hono } from 'hono'
import { type SpecType } from '../spec-store.js'
import { classifyMime, mimeForExt } from '../attachment-store.js'
import type { ProjectInstance } from '../project-registry.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

export function createSpecsRoutes(resolveProject: ResolveProject): Hono {
  const app = new Hono()

  const need = async (c: import('hono').Context): Promise<ProjectInstance | Response> => {
    const id = c.req.param('projectId') ?? ''
    if (!id) return c.json({ error: 'projectId required' }, 400)
    const project = await resolveProject(id)
    if (!project) return c.json({ error: 'project not found' }, 404)
    return project
  }

  app.get('/projects/:projectId/specs', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const items = await p.store.list()
    return c.json(items)
  })

  app.post('/projects/:projectId/specs', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const input = parseCreateBody(body)
    if ('error' in input) return c.json({ error: input.error }, 400)
    if (!input.title && input.requirement) {
      const prompt = buildDraftPrompt(input.type, input.requirement, input.draftId)
      const draftSpecId = `__draft__-${cryptoRandomId()}`
      const handle = p.runner.run({ specId: draftSpecId, mode: 'skill-run', prompt })
      return c.json({ runId: handle.id, draft: true }, 202)
    }
    try {
      const { id, path } = await p.store.create(input)
      return c.json({ id, path }, 201)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
  })

  app.get('/projects/:projectId/specs/:id', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const detail = await p.store.read(c.req.param('id'))
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    return c.json(detail)
  })

  app.get('/projects/:projectId/specs/:id/attachments/:name', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const id = c.req.param('id')
    const name = c.req.param('name')
    if (!isSafeAttachmentName(name)) {
      return c.json({ error: 'invalid attachment name' }, 400)
    }
    const detail = await p.store.read(id)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    const file = join(p.specsDir, id, 'attachments', name)
    if (!existsSync(file)) return c.json({ error: 'attachment not found' }, 404)
    const ext = extname(name).toLowerCase()
    const mime = mimeForExt(ext)
    const kind = classifyMime(mime)
    const data = await readFile(file)
    c.header('Content-Type', mime)
    c.header(
      'Content-Disposition',
      kind === 'image' || kind === 'pdf' || kind === 'text' ? 'inline' : 'attachment',
    )
    c.header('Cache-Control', 'max-age=300')
    return c.body(new Uint8Array(data))
  })

  app.post('/projects/:projectId/specs/:id/inputs', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const parsed = parseAnnotateBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      await p.store.appendAnnotation(c.req.param('id'), parsed)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404)
    }
  })

  app.post('/projects/:projectId/specs/:id/questions/answers', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const parsed = parseQuestionAnswersBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      await p.store.applyQuestionAnswers(c.req.param('id'), parsed)
      return c.json({ ok: true })
    } catch (err) {
      const msg = (err as Error).message
      const status = /spec not found/.test(msg) ? 404 : 400
      return c.json({ error: msg }, status)
    }
  })

  app.post('/projects/:projectId/specs/:id/appends', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const parsed = parseAppendBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    try {
      await p.store.appendItem(specId, {
        kind: parsed.kind,
        description: parsed.description,
        sectionPath: parsed.sectionPath,
        quote: parsed.quote,
      })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
    if (parsed.autoRun) {
      const handle = p.runner.run({
        specId,
        mode: 'skill-run',
        prompt: `请使用 yorz-spec skill 处理 spec：${p.specsDirRelative}/${specId}/spec.md`,
      })
      return c.json({ ok: true, runId: handle.id })
    }
    return c.json({ ok: true })
  })

  app.post('/projects/:projectId/specs/:id/run', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    const handle = p.runner.run({
      specId,
      mode: 'skill-run',
      prompt: `请使用 yorz-spec skill 处理 spec：${p.specsDirRelative}/${specId}/spec.md`,
    })
    return c.json({ runId: handle.id })
  })

  app.post('/projects/:projectId/specs/:id/explain', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const text = body && typeof body === 'object' ? (body as { text?: unknown }).text : undefined
    if (typeof text !== 'string' || !text.trim()) {
      return c.json({ error: 'text required' }, 400)
    }
    if (text.length > 4000) {
      return c.json({ error: 'text too long (max 4000)' }, 400)
    }
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    const prompt =
      `以下为 spec 文档 ${p.specsDirRelative}/${specId}/spec.md 中的一段内容。\n` +
      `请用中文简洁解释其含义、背景与可能的实施影响。**不要**修改任何文件，只在终端输出解释文本。\n\n` +
      `引用：\n"""\n${text}\n"""\n`
    const handle = p.runner.run({ specId, mode: 'explain', prompt })
    return c.json({ runId: handle.id })
  })

  return app
}

export function buildDraftPrompt(type: SpecType, requirement: string, draftId?: string): string {
  const lines = [
    '请按 yorz-spec skill 的「新建 spec」流程，根据下方信息创建新的 spec 文档，并立即按 plan 阶段继续推进直至阻塞。',
    '',
    `类型：${type}（已由调用方指定，不要再询问）`,
    '需求：',
    '"""',
    requirement.trim(),
    '"""',
    '',
    '硬性要求：',
    `- 生成 kebab-case summary-name 时只使用对需求有语义代表性的英文/数字字符；如难以从中文中提炼出可读 slug，请直接使用 \`untitled-\` + 3 位日期内自增编号占位，禁止把中文挤压为零散英文片段（例如禁止出现 \`spec-agent-spec-agent\` 之类的拼接）。`,
    '- frontmatter.summary 必须是对需求的真实概述（≤200 字符），不要原样照搬整段需求。',
    '- 完成 spec 文件初始化后立即进入 plan 阶段，按 SKILL 规则补齐 `现状分析` / `技术实现方案` / `待确认问题`，再视需要进入 tasks/execute。',
  ]
  if (draftId) {
    lines.push(
      '',
      `附件迁移：本次新建 spec 关联了草稿附件目录 \`.yorz/tmp/drafts/${draftId}/attachments/\`。`,
      '- 在创建 `.yorz/specs/<id>/` 目录并写入 `spec.md` 骨架**之后**，立即把该 draft 目录下的所有文件迁移到 `.yorz/specs/<id>/attachments/`，文件名保持不变。',
      '- 迁移完成后，在 `## 背景` 章节末尾追加一段附件列表，每个附件占一行（按文件扩展名判定 `kind`）：',
      '  - 图片（`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.bmp` / `.svg` / `.avif` / `.heic`）：使用 `![<文件名>](attachments/<文件名>)`',
      '  - PDF（`.pdf`） / 文本（`.txt` / `.md` / `.markdown`）：使用 `[<文件名>](attachments/<文件名>)`',
      '- 迁移失败（如 draft 目录已被清理、权限不足）时，**不要静默丢弃**：在 `## 待确认问题` 章节追加一条记录说明问题，并退出本轮等待用户介入。',
    )
  }
  return lines.join('\n')
}

function cryptoRandomId(): string {
  return randomUUID().slice(0, 8)
}

type CreateInput = {
  type: SpecType
  title?: string
  summary?: string
  requirement?: string
  draftId?: string
}

function parseCreateBody(body: unknown): CreateInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' }
  const obj = body as Record<string, unknown>
  const rawType = (obj.type as string | undefined) ?? 'feat'
  if (rawType !== 'feat' && rawType !== 'refct' && rawType !== 'fix') {
    return { error: 'type must be feat | refct | fix' }
  }
  const out: CreateInput = { type: rawType }
  if (typeof obj.title === 'string' && obj.title.trim()) out.title = obj.title
  if (typeof obj.summary === 'string' && obj.summary.trim()) out.summary = obj.summary
  if (typeof obj.requirement === 'string' && obj.requirement.trim()) {
    out.requirement = obj.requirement
  }
  if (obj.draftId !== undefined) {
    if (typeof obj.draftId !== 'string' || !obj.draftId.trim()) {
      return { error: 'draftId must be a non-empty string' }
    }
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(obj.draftId)) {
      return { error: 'draftId has invalid format' }
    }
    out.draftId = obj.draftId
  }
  return out
}

function isSafeAttachmentName(name: string): boolean {
  if (!name) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name === '.' || name === '..') return false
  if (name.startsWith('.')) return false
  return true
}

interface AnnotateInput {
  sectionPath: string
  quote: string
  note: string
}

interface QuestionAnswersInput {
  answers: Array<{
    questionId?: string
    questionText: string
    selectedOptionLabel?: string
    note?: string
  }>
  freeformAnnotations: Array<{ sectionPath: string; quote: string; note: string }>
}

function parseQuestionAnswersBody(body: unknown): QuestionAnswersInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' }
  const obj = body as Record<string, unknown>
  const rawAnswers = obj.answers
  const rawFreeforms = obj.freeformAnnotations
  if (rawAnswers !== undefined && !Array.isArray(rawAnswers)) {
    return { error: 'answers must be an array' }
  }
  if (rawFreeforms !== undefined && !Array.isArray(rawFreeforms)) {
    return { error: 'freeformAnnotations must be an array' }
  }
  const answers: QuestionAnswersInput['answers'] = []
  for (const a of (rawAnswers ?? []) as unknown[]) {
    if (!a || typeof a !== 'object') return { error: 'answer must be an object' }
    const ao = a as Record<string, unknown>
    if (typeof ao.questionText !== 'string' || !ao.questionText.trim()) {
      return { error: 'answer.questionText required' }
    }
    const item: QuestionAnswersInput['answers'][number] = { questionText: ao.questionText }
    if (typeof ao.questionId === 'string') item.questionId = ao.questionId
    if (typeof ao.selectedOptionLabel === 'string' && ao.selectedOptionLabel.trim()) {
      item.selectedOptionLabel = ao.selectedOptionLabel
    }
    if (typeof ao.note === 'string' && ao.note.trim()) item.note = ao.note
    if (!item.selectedOptionLabel && !item.note) {
      return { error: 'answer requires selectedOptionLabel or note' }
    }
    answers.push(item)
  }
  const freeformAnnotations: QuestionAnswersInput['freeformAnnotations'] = []
  for (const f of (rawFreeforms ?? []) as unknown[]) {
    if (!f || typeof f !== 'object') return { error: 'freeformAnnotation must be an object' }
    const fo = f as Record<string, unknown>
    if (typeof fo.sectionPath !== 'string' || !fo.sectionPath.trim()) {
      return { error: 'freeformAnnotation.sectionPath required' }
    }
    if (typeof fo.quote !== 'string' || !fo.quote.trim()) {
      return { error: 'freeformAnnotation.quote required' }
    }
    if (typeof fo.note !== 'string' || !fo.note.trim()) {
      return { error: 'freeformAnnotation.note required' }
    }
    freeformAnnotations.push({
      sectionPath: fo.sectionPath,
      quote: fo.quote,
      note: fo.note,
    })
  }
  if (answers.length === 0 && freeformAnnotations.length === 0) {
    return { error: 'answers or freeformAnnotations required' }
  }
  return { answers, freeformAnnotations }
}

interface AppendInput {
  kind: 'feat' | 'refct' | 'fix'
  description: string
  sectionPath?: string
  quote?: string
  autoRun: boolean
}

function parseAppendBody(body: unknown): AppendInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' }
  const obj = body as Record<string, unknown>
  const kind = obj.kind
  if (kind !== 'feat' && kind !== 'refct' && kind !== 'fix') {
    return { error: 'kind must be feat | refct | fix' }
  }
  if (typeof obj.description !== 'string' || !obj.description.trim()) {
    return { error: 'description required' }
  }

  const out: AppendInput = { kind, description: obj.description, autoRun: true }
  if (obj.sectionPath !== undefined) {
    if (typeof obj.sectionPath !== 'string') return { error: 'sectionPath must be a string' }
    if (obj.sectionPath.length > 200) return { error: 'sectionPath too long (max 200)' }
    if (obj.sectionPath.trim()) out.sectionPath = obj.sectionPath
  }
  if (obj.quote !== undefined) {
    if (typeof obj.quote !== 'string') return { error: 'quote must be a string' }
    if (obj.quote.length > 500) return { error: 'quote too long (max 500)' }
    if (obj.quote.trim()) out.quote = obj.quote
  }
  if (obj.autoRun !== undefined) {
    if (typeof obj.autoRun !== 'boolean') return { error: 'autoRun must be a boolean' }
    out.autoRun = obj.autoRun
  }
  return out
}

function parseAnnotateBody(body: unknown): AnnotateInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' }
  const obj = body as Record<string, unknown>
  if (obj.kind !== 'annotate') {
    return { error: 'kind must be "annotate"' }
  }
  const sectionPath = obj.sectionPath
  const quote = obj.quote
  const note = obj.note
  if (typeof sectionPath !== 'string' || !sectionPath.trim()) {
    return { error: 'sectionPath required' }
  }
  if (typeof quote !== 'string' || !quote.trim()) return { error: 'quote required' }
  if (typeof note !== 'string' || !note.trim()) return { error: 'note required' }
  if (sectionPath.length > 200) return { error: 'sectionPath too long (max 200)' }
  if (quote.length > 2000) return { error: 'quote too long (max 2000)' }
  if (note.length > 2000) return { error: 'note too long (max 2000)' }
  return { sectionPath, quote, note }
}
