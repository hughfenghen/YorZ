import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Hono } from 'hono'
import { type SpecType } from '../spec-store.js'
import { classifyMime, mimeForExt } from '../attachment-store.js'
import type { ProjectInstance } from '../project-registry.js'
import type { CommandRun } from '../command-types.js'
import { getLogger } from '../logger.js'
import { buildDraftDispatch, buildSpecDispatch } from '../slash-command.js'
import { trackSpecStage } from '../telemetry/index.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

/**
 * Same-spec serialization. Rounds used to share one session, which queued a
 * second dispatch behind the first; now that each round gets its own session,
 * nothing would stop two agents from editing the same `spec.md` at once. Refuse
 * instead of queueing: the user can retry once the visible round ends.
 */
export const SPEC_BUSY_ERROR = '该 spec 有正在执行的会话，请等待其结束后再试'

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
      // Attachments were uploaded to whichever project the user was looking at.
      // When the spec lands in a just-created worktree that is a *different*
      // project, carry the draft over first or the migration below has nothing
      // to move (see AttachmentStore.importDraftFrom).
      if (input.draftId && input.draftProjectId && input.draftProjectId !== p.id) {
        const source = await resolveProject(input.draftProjectId)
        if (source) {
          try {
            await p.attachments.importDraftFrom(source.attachments, input.draftId)
          } catch (err) {
            // Failing loudly beats dispatching: the agent would stall on a
            // 待确认项 about missing files and the attachments would be lost.
            return c.json({ error: `draft attachments copy failed: ${(err as Error).message}` }, 400)
          }
        }
      }
      const beforeIds = new Set((await p.store.list()).map((s) => s.id))
      const { commandLine, prompt } = buildDraftDispatch({
        specsDirRelative: p.specsDirRelative,
        type: input.type,
        requirement: input.requirement,
        draftId: input.draftId,
      })
      const { sessionId } = await p.sessions.createSession()
      const handle = await p.sessions.send(sessionId, prompt, commandLine, { trigger: 'new-spec' })
      handle.onDone((finalSessionId) => {
        void bindDraftSessionToCreatedSpec(p, beforeIds, finalSessionId)
      })
      return c.json({ runId: handle.runId, sessionId, draft: true }, 202)
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

  app.patch('/projects/:projectId/specs/:id/stage', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const stage = body && typeof body === 'object' ? (body as { stage?: unknown }).stage : undefined
    if (stage !== 'plan' && stage !== 'tasks' && stage !== 'execute' && stage !== 'done') {
      return c.json({ error: 'stage must be plan | tasks | execute | done' }, 400)
    }
    try {
      await p.store.setStage(specId, stage)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404)
    }
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
      // The item is already persisted, so a busy spec is NOT an error here: it
      // only means we skip the dispatch. Reporting it as a failed request would
      // invite the user to resubmit and duplicate the append item.
      if (await p.sessions.isSpecRunning(specId)) return c.json({ ok: true, busy: true })
      // Guard BEFORE minting a session, or a refused dispatch would leave an
      // empty shell session behind in the list.
      const { sessionId } = await p.sessions.createSessionForSpec(specId)
      // A `fix` append *is* Debug mode. The reentry guard widens that: an active
      // debug.md keeps the session in Debug mode whatever this append's kind.
      const debugActive = (await readDebugMdStatus(join(p.specsDir, specId))) === 'debugging'
      const debug = parsed.kind === 'fix' || debugActive
      const { commandLine, prompt } = buildSpecDispatch({
        specsDirRelative: p.specsDirRelative,
        specId,
        debug,
        body: parsed.description,
        runtimeContext: debug ? await buildDebugRuntimeContext(p) : undefined,
      })
      const handle = await p.sessions.send(sessionId, prompt, commandLine, {
        trigger: 'append',
        specId,
      })
      trackSpecStage({
        projectRoot: p.path,
        store: p.store,
        specId,
        handle,
        before: detail,
        trigger: 'append',
      })
      return c.json({ ok: true, runId: handle.runId, sessionId })
    }
    return c.json({ ok: true })
  })

  app.post('/projects/:projectId/specs/:id/run', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    if (await p.sessions.isSpecRunning(specId)) return c.json({ error: SPEC_BUSY_ERROR }, 409)
    const { sessionId } = await p.sessions.createSessionForSpec(specId)
    // Reentry guard: if a debug session is still active, keep run in Debug mode.
    const debugActive = (await readDebugMdStatus(join(p.specsDir, specId))) === 'debugging'
    const { commandLine, prompt } = buildSpecDispatch({
      specsDirRelative: p.specsDirRelative,
      specId,
      debug: debugActive,
      runtimeContext: debugActive ? await buildDebugRuntimeContext(p) : undefined,
    })
    const handle = await p.sessions.send(sessionId, prompt, commandLine, {
      trigger: 'run',
      specId,
    })
    trackSpecStage({
      projectRoot: p.path,
      store: p.store,
      specId,
      handle,
      before: detail,
      trigger: 'run',
    })
    return c.json({ runId: handle.runId, sessionId })
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
    if (await p.sessions.isSpecRunning(specId)) return c.json({ error: SPEC_BUSY_ERROR }, 409)
    // User-driven: explain answers about the text the user is looking at, so it
    // continues the visible conversation instead of starting a cold session.
    const { sessionId } = await p.sessions.latestSessionForSpec(specId)
    // Explain never edits the spec, so only the dispatch cost is attributed —
    // no `spec.stage` transition to record.
    const handle = await p.sessions.send(sessionId, prompt, undefined, {
      trigger: 'explain',
      specId,
    })
    return c.json({ runId: handle.runId, sessionId })
  })

  app.delete('/projects/:projectId/specs/:id', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    await p.store.delete(specId)
    return c.json({ ok: true })
  })

  return app
}

async function bindDraftSessionToCreatedSpec(
  project: ProjectInstance,
  beforeIds: Set<string>,
  sessionId: string,
): Promise<void> {
  try {
    const created = (await project.store.list()).filter((s) => !beforeIds.has(s.id))
    if (created.length !== 1) {
      getLogger().child('agent').warn('skip draft session binding', {
        sessionId,
        createdCount: created.length,
      })
      return
    }
    const [spec] = created
    const ok = await project.sessions.bindSessionToSpec(
      sessionId,
      spec.id,
      formatSpecSessionTitle(spec.id, spec.summary),
    )
    if (!ok) {
      getLogger().child('agent').warn('draft session binding target missing', {
        sessionId,
        specId: spec.id,
      })
    }
  } catch (err) {
    getLogger()
      .child('agent')
      .warn('draft session binding failed', {
        sessionId,
        message: err instanceof Error ? err.message : String(err),
      })
  }
}

function formatSpecSessionTitle(specId: string, summary: string): string {
  const s = summary.trim()
  return s ? `${specId} · ${s}` : specId
}

/**
 * Read the `status` frontmatter field of `<specDir>/debug.md`. Returns
 * `'debugging'` / `'resolved'` when present, or `null` when the file is absent
 * or has no recognizable status (a pure read-only guard — never throws).
 */
export async function readDebugMdStatus(specDir: string): Promise<'debugging' | 'resolved' | null> {
  const file = join(specDir, 'debug.md')
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return null
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const statusLine = m[1].split(/\r?\n/).find((l) => /^status\s*:/.test(l.trim()))
  if (!statusLine) return null
  const val = statusLine
    .slice(statusLine.indexOf(':') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
  return val === 'debugging' ? 'debugging' : val === 'resolved' ? 'resolved' : null
}

async function buildDebugRuntimeContext(project: ProjectInstance): Promise<string> {
  return formatDebugRuntimeContext(await project.commands.listRuns())
}

export function formatDebugRuntimeContext(runs: CommandRun[]): string {
  const running = runs.filter((r) => r.status === 'running')
  if (running.length === 0) {
    return (
      '\n\n当前项目运行服务上下文：暂无运行中的命令服务。' +
      '若复现需要服务，请根据项目脚本自行启动，或请用户在 GUI 命令菜单启动后重试。'
    )
  }
  const lines = ['\n\n当前项目运行服务上下文：']
  for (const run of running) {
    lines.push(
      `- runId: ${promptScalar(run.runId)}`,
      `  name: ${promptScalar(run.name)}`,
      `  cli: ${promptScalar(run.cli)}`,
      `  status: ${run.status}`,
      `  pid: ${run.pid}`,
      `  startedAt: ${new Date(run.startedAt).toISOString()}`,
      `  logFile: ${promptScalar(run.logFile)}`,
    )
  }
  return lines.join('\n')
}

function promptScalar(value: string): string {
  return value.replace(/\r?\n/g, '\\n')
}

type CreateInput = {
  type: SpecType
  title?: string
  summary?: string
  requirement?: string
  draftId?: string
  /** Project the draft attachments were uploaded to, when it differs (worktree). */
  draftProjectId?: string
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
  if (obj.draftProjectId !== undefined) {
    if (typeof obj.draftProjectId !== 'string' || !obj.draftProjectId.trim()) {
      return { error: 'draftProjectId must be a non-empty string' }
    }
    out.draftProjectId = obj.draftProjectId.trim()
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
  // `debug` used to be an explicit opt-in checkbox; `kind === 'fix'` now implies
  // it. A stale GUI bundle may still send the field — ignore it rather than
  // rejecting, or a cached page would fail every append.
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
