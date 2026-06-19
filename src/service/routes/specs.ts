import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { SpecStore, type SpecType } from '../spec-store.js'
import type { AgentRunner } from '../agent.js'
import type { TouchedFilesStore } from '../touched-files.js'
import { commit as gitCommit, listChanges, GitError } from '../git.js'

interface Deps {
  store: SpecStore
  runner: AgentRunner
  touched: TouchedFilesStore
  cwd: string
}

const SPEC_ANCHOR_RE = /\[spec:[^\]]+\]/

function ensureSpecAnchor(message: string, specId: string): string {
  if (SPEC_ANCHOR_RE.test(message)) return message
  const trimmed = message.replace(/\s+$/, '')
  return `${trimmed}\n\n[spec:${specId}]\n`
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
    // Draft mode: caller only supplies type + requirement -> delegate creation
    // (filename / summary / skeleton) to the Agent via yorz-spec skill so the
    // id is derived from a real understanding of the requirement instead of a
    // dumb kebab() of CJK text.
    if (!input.title && input.requirement) {
      const prompt = buildDraftPrompt(input.type, input.requirement)
      const draftSpecId = `__draft__-${cryptoRandomId()}`
      const handle = deps.runner.run({ specId: draftSpecId, mode: 'skill-run', prompt })
      return c.json({ runId: handle.id, draft: true }, 202)
    }
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
    const parsed = parseAnnotateBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      await deps.store.appendAnnotation(c.req.param('id'), parsed)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404)
    }
  })

  app.post('/specs/:id/questions/answers', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const parsed = parseQuestionAnswersBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    try {
      await deps.store.applyQuestionAnswers(c.req.param('id'), parsed)
      return c.json({ ok: true })
    } catch (err) {
      const msg = (err as Error).message
      const status = /spec not found/.test(msg) ? 404 : 400
      return c.json({ error: msg }, status)
    }
  })

  app.post('/specs/:id/appends', async (c) => {
    const specId = c.req.param('id')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const parsed = parseAppendBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    const detail = await deps.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    try {
      await deps.store.appendItem(specId, {
        kind: parsed.kind,
        description: parsed.description,
        sectionPath: parsed.sectionPath,
        quote: parsed.quote,
      })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
    if (parsed.autoRun) {
      const handle = deps.runner.run({
        specId,
        mode: 'skill-run',
        prompt: `请使用 yorz-spec skill 处理 spec：.yorz/specs/${specId}/spec.md`,
      })
      return c.json({ ok: true, runId: handle.id })
    }
    return c.json({ ok: true })
  })

  app.post('/specs/:id/run', async (c) => {
    const specId = c.req.param('id')
    const detail = await deps.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    const handle = deps.runner.run({
      specId,
      mode: 'skill-run',
      prompt: `请使用 yorz-spec skill 处理 spec：.yorz/specs/${specId}/spec.md`,
    })
    return c.json({ runId: handle.id })
  })

  app.get('/specs/:id/changes', async (c) => {
    const specId = c.req.param('id')
    const detail = await deps.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    const [touched, allChanges] = await Promise.all([
      deps.touched.read(specId),
      listChanges(deps.cwd),
    ])
    if (touched.length === 0) return c.json({ changes: [] })
    const set = new Set(touched)
    const ignored = deps.touched.relativeFilePath(specId)
    const filtered = allChanges
      .filter((c) => c.path !== ignored && set.has(c.path))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return c.json({ changes: filtered })
  })

  app.post('/specs/:id/commit', async (c) => {
    const specId = c.req.param('id')
    const detail = await deps.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const parsed = parseCommitBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)

    const touched = await deps.touched.read(specId)
    if (touched.length === 0) {
      return c.json({ error: 'no touched files to commit' }, 409)
    }
    const allChanges = await listChanges(deps.cwd)
    const ignored = deps.touched.relativeFilePath(specId)
    const candidatePaths = new Set(
      allChanges
        .filter((ch) => ch.path !== ignored && touched.includes(ch.path))
        .map((ch) => ch.path),
    )
    let pathsToCommit: string[]
    if (parsed.paths) {
      for (const p of parsed.paths) {
        if (!candidatePaths.has(p)) {
          return c.json({ error: `path not in touched changes: ${p}` }, 400)
        }
      }
      pathsToCommit = parsed.paths
    } else {
      pathsToCommit = Array.from(candidatePaths).sort()
    }
    if (pathsToCommit.length === 0) {
      return c.json({ error: 'no touched files to commit' }, 409)
    }

    const message = ensureSpecAnchor(parsed.message, specId)
    try {
      const { commit } = await gitCommit(deps.cwd, { message, paths: pathsToCommit })
      await deps.touched.remove(specId, pathsToCommit)
      const firstLine = parsed.message.split(/\r?\n/)[0]!.trim() || '(no message)'
      const short = commit.slice(0, 7)
      const line = `${today()} 提交 ${short}：${firstLine}（${pathsToCommit.length} 个文件）`
      try {
        await deps.store.appendExecutionLog(specId, line)
      } catch {
        // best-effort: commit already happened
      }
      return c.json({ ok: true, commit })
    } catch (err) {
      if (err instanceof GitError) {
        const status = err.code === 'invalid_path' || err.code === 'invalid_message' ? 400 : 500
        return c.json({ ok: false, error: err.message, stderr: err.stderr }, status)
      }
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/specs/:id/explain', async (c) => {
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
    const detail = await deps.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    const prompt =
      `以下为 spec 文档 .yorz/specs/${specId}/spec.md 中的一段内容。\n` +
      `请用中文简洁解释其含义、背景与可能的实施影响。**不要**修改任何文件，只在终端输出解释文本。\n\n` +
      `引用：\n"""\n${text}\n"""\n`
    const handle = deps.runner.run({ specId, mode: 'explain', prompt })
    return c.json({ runId: handle.id })
  })

  return app
}

function buildDraftPrompt(type: SpecType, requirement: string): string {
  return [
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
  ].join('\n')
}

function cryptoRandomId(): string {
  return randomUUID().slice(0, 8)
}

type CreateInput = {
  type: SpecType
  title?: string
  summary?: string
  requirement?: string
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
  return out
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
  if (obj.description.length > 4000) return { error: 'description too long (max 4000)' }
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

interface CommitInput {
  message: string
  paths?: string[]
}

function parseCommitBody(body: unknown): CommitInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' }
  const obj = body as Record<string, unknown>
  const message = obj.message
  if (typeof message !== 'string' || !message.trim()) {
    return { error: 'message required' }
  }
  if (message.length > 2000) return { error: 'message too long (max 2000)' }
  const out: CommitInput = { message: message.trim() }
  if (obj.paths !== undefined) {
    if (!Array.isArray(obj.paths)) return { error: 'paths must be an array' }
    const paths: string[] = []
    for (const p of obj.paths) {
      if (typeof p !== 'string' || !p) return { error: 'paths entries must be non-empty strings' }
      paths.push(p)
    }
    out.paths = paths
  }
  return out
}

function today(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
