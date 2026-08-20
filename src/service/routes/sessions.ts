import { Hono } from 'hono'
import type { AgentKind } from '../agent-sdk/types.js'
import type { AttachmentMeta } from '../attachment-store.js'
import type { ProjectInstance } from '../project-registry.js'
import { cleanupExpiredChatDebugFiles } from '../chat-debug.js'
import {
  appendHiddenPrompt,
  mergeCustomInstructions,
  type CustomInstruction,
} from '../custom-instruction.js'
import { loadGlobalConfig } from '../global-config.js'
import { loadProjectConfig } from '../project-config.js'
import { isSlashCommand, resolveChatPrompt } from '../slash-command.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

/**
 * Slash commands the user can invoke, project scope first. Either config
 * failing to load degrades to that scope being empty rather than failing the
 * send.
 */
async function loadCustomInstructions(projectPath: string): Promise<CustomInstruction[]> {
  const [project, global] = await Promise.all([
    loadProjectConfig(projectPath)
      .then((cfg) => cfg.customInstructions)
      .catch(() => [] as CustomInstruction[]),
    loadGlobalConfig()
      .then((cfg) => cfg.customInstructions)
      .catch(() => [] as CustomInstruction[]),
  ])
  return mergeCustomInstructions(project, global)
}

const KINDS: AgentKind[] = ['claude', 'codex', 'opencode']
const DRAFT_ID_RE = /^[a-zA-Z0-9-]{1,64}$/

/**
 * Append a readable, non-migrating attachment block to a chat prompt. Mirrors the
 * spec-draft flow but for the transient chat case: files stay in `.yorz/tmp` and
 * the Agent reads them in place. Returns the prompt unchanged when there are none.
 */
export function buildChatPrompt(
  prompt: string,
  draftId: string,
  attachments: AttachmentMeta[],
): string {
  if (attachments.length === 0) return prompt
  const dir = `.yorz/tmp/drafts/${draftId}/attachments`
  const lines = attachments.map((a) => {
    const rel = `${dir}/${a.storedName}`
    return a.kind === 'image' ? `- ![${a.name}](${rel})` : `- [${a.name}](${rel})`
  })
  // Hidden: the GUI renders attachments from its own state, so echoing the
  // paths into the bubble would desync it from the optimistic render.
  return appendHiddenPrompt(
    prompt,
    [
      '---',
      `本次消息附带 ${attachments.length} 个附件，已保存在临时目录 \`${dir}/\`（请按需用文件工具直接读取，无需迁移）：`,
      ...lines,
    ].join('\n'),
  )
}

export function createSessionsRoutes(resolveProject: ResolveProject): Hono {
  const app = new Hono()

  const need = async (c: import('hono').Context): Promise<ProjectInstance | Response> => {
    const id = c.req.param('projectId') ?? ''
    if (!id) return c.json({ error: 'projectId required' }, 400)
    const project = await resolveProject(id)
    if (!project) return c.json({ error: 'project not found' }, 404)
    return project
  }

  app.get('/projects/:projectId/sessions', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    return c.json(await p.sessions.listSessions())
  })

  app.get('/projects/:projectId/agent-usage', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    return c.json(await p.sessions.getUsageStatus())
  })

  app.post('/projects/:projectId/sessions', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    let body: { title?: unknown; agentKind?: unknown } = {}
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      // empty body is allowed
    }
    const kind = KINDS.includes(body.agentKind as AgentKind)
      ? (body.agentKind as AgentKind)
      : undefined
    const title = typeof body.title === 'string' ? body.title : undefined
    try {
      const created = await p.sessions.createSession(kind, title)
      return c.json(created, 201)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  app.get('/projects/:projectId/specs/:id/session', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const specId = c.req.param('id')
    const detail = await p.store.read(specId)
    if (!detail) return c.json({ error: 'spec not found' }, 404)
    try {
      // Read-only probe: never mint a session here. Opening a spec detail page
      // must not create a session that would never run a turn.
      const found = await p.sessions.findSessionForSpec(specId)
      // Surface the live run state so the detail page can hide the confirm panel
      // even when the turn was started by a background/other session.
      if (!found) return c.json({ sessionId: null, kind: null, running: false })
      return c.json({ ...found, running: p.sessions.isRunning(found.sessionId) })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  app.get('/projects/:projectId/sessions/:sid/messages', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    try {
      return c.json(await p.sessions.getMessages(c.req.param('sid')))
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  app.post('/projects/:projectId/sessions/:sid/messages', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    let body: { prompt?: unknown; draftId?: unknown } = {}
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt) return c.json({ error: 'prompt required' }, 400)

    // Expansion chain: slash command (built-ins, then the user's configured
    // instructions, then the unknown-command fallback), then attachments. Each
    // step keeps the user's own text verbatim so the GUI can strip the injected
    // blocks back out.
    // Both scopes are read per send rather than cached on the ProjectInstance:
    // `.yorz/config.json` has no watcher, so a cached copy would go stale the
    // moment the user hand-edits it.
    const instructions = isSlashCommand(prompt)
      ? await loadCustomInstructions(p.path)
      : ([] as CustomInstruction[])
    const resolved = resolveChatPrompt(prompt, instructions, {
      specsDirRelative: p.specsDirRelative,
    })
    let finalPrompt = resolved.prompt
    // Optional attachment draft: list its files and append their readable paths so
    // the Agent can read them in place. A malformed/missing draft degrades to the
    // plain prompt rather than failing the send.
    if (body.draftId !== undefined) {
      if (typeof body.draftId !== 'string' || !DRAFT_ID_RE.test(body.draftId)) {
        return c.json({ error: 'draftId has invalid format' }, 400)
      }
      const draftId = body.draftId
      if (await p.attachments.draftExists(draftId)) {
        const metas = await p.attachments.listAttachments(draftId)
        finalPrompt = buildChatPrompt(finalPrompt, draftId, metas)
      }
    }
    if (resolved.builtin === 'yorz-debug') void cleanupExpiredChatDebugFiles(p.path).catch(() => {})

    // Title comes from what the user typed, not the expanded prompt.
    const handle = await p.sessions.send(c.req.param('sid'), finalPrompt, prompt, {
      trigger: 'chat',
    })
    return c.json({ runId: handle.runId, sessionId: handle.sessionId }, 202)
  })

  app.post('/projects/:projectId/sessions/:sid/abort', async (c) => {
    const p = await need(c)
    if (p instanceof Response) return p
    const ok = await p.sessions.abort(c.req.param('sid'))
    return c.json({ aborted: ok })
  })

  return app
}
