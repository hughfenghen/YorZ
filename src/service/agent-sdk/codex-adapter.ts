import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'
import { Codex, type Thread, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk'
import { normalizeUsage } from '../telemetry/index.js'
import type {
  AgentContextKind,
  AgentEvent,
  AgentSdkAdapter,
  AgentSession,
  Capabilities,
  AgentUsageStatus,
  AgentUsageWindow,
  MessagePart,
  NormalizedMessage,
  SendOptions,
  SessionInfo,
} from './types.js'

const DEFAULT_CODEX_STORAGE_ROOT = join(homedir(), '.codex')
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/codex/usage'
const TITLE_MAX_LENGTH = 64

function codexThreadOptions(cwd: string): ThreadOptions {
  return {
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
  }
}

function detectAgentContextKind(text: string): AgentContextKind | undefined {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('<recommended_plugins>') && trimmed.includes('</recommended_plugins>')) {
    return 'recommended_plugins'
  }
  if (
    trimmed.startsWith('# AGENTS.md instructions for ') &&
    trimmed.includes('<INSTRUCTIONS>') &&
    trimmed.includes('</INSTRUCTIONS>')
  ) {
    return 'agents_instructions'
  }
  if (trimmed.startsWith('<environment_context>') && trimmed.includes('</environment_context>')) {
    return 'environment_context'
  }
  return undefined
}

function textFromMessagePayload(payload: Record<string, unknown>): string {
  const content = payload.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const c of content) {
    const text = (c as { text?: unknown })?.text
    if (typeof text === 'string' && text.trim()) parts.push(text)
  }
  return parts.join('\n').trim()
}

export function summarizeCodexPromptForTitle(text: string): string {
  const [body] = text.split(/^\s*---\s*$/m)
  const cleaned = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== '---' && !line.startsWith('- ![') && !line.startsWith('- ['))
    .join(' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[@#>*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  return cleaned.length > TITLE_MAX_LENGTH ? `${cleaned.slice(0, TITLE_MAX_LENGTH - 1)}…` : cleaned
}

export function parseCodexSessionIndex(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    const rec = obj as { id?: unknown; thread_name?: unknown }
    const id = typeof rec.id === 'string' ? rec.id.trim() : ''
    const title = typeof rec.thread_name === 'string' ? rec.thread_name.trim() : ''
    if (id && title) out.set(id, title)
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function resetFrom(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return new Date(n * 1000).toISOString()
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }
  const n = numberFrom(value)
  return n == null ? null : new Date(n * 1000).toISOString()
}

function codexWindow(key: string, label: string, value: unknown): AgentUsageWindow | null {
  const rec = asRecord(value)
  if (!rec) return null
  const utilization =
    numberFrom(rec.used_percent) ??
    numberFrom(rec.usedPercent) ??
    numberFrom(rec.utilization) ??
    numberFrom(rec.percent_used)
  if (utilization == null) return null
  return {
    key,
    label,
    utilization,
    resetsAt: resetFrom(rec.resets_at ?? rec.reset_at ?? rec.resetsAt ?? rec.resetAt),
  }
}

export function parseCodexUsageResponse(raw: unknown): AgentUsageStatus | null {
  const root = asRecord(raw)
  if (!root) return null
  const rateLimit = asRecord(root.rate_limit)
  const rateLimits = asRecord(root.rate_limits)
  const windows: AgentUsageWindow[] = []
  const primary = codexWindow(
    'primary',
    'Primary',
    rateLimit?.primary_window ?? rateLimits?.primary ?? root.primary,
  )
  if (primary) windows.push(primary)
  const secondary = codexWindow(
    'secondary',
    'Secondary',
    rateLimit?.secondary_window ?? rateLimits?.secondary ?? root.secondary,
  )
  if (secondary) windows.push(secondary)
  const additional =
    root.additional_rate_limits ?? root.additionalRateLimits ?? rateLimit?.additional
  if (Array.isArray(additional)) {
    for (const [idx, item] of additional.entries()) {
      const rec = asRecord(item)
      const label = String(rec?.label ?? rec?.name ?? rec?.limit_name ?? `Additional ${idx + 1}`)
      const win = codexWindow(`additional:${idx}`, label, item)
      if (win) windows.push(win)
    }
  }
  if (windows.length === 0) return null
  return {
    kind: 'codex',
    status: 'available',
    checkedAt: Date.now(),
    source: 'private-api',
    subscriptionType: typeof root.plan_type === 'string' ? root.plan_type : null,
    rateLimitsAvailable: true,
    windows,
  }
}

export function parseCodexTokenCountSnapshot(text: string): AgentUsageStatus | null {
  let latestTs = 0
  let latest: AgentUsageStatus | null = null
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: unknown
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    const rec = asRecord(obj)
    const payload = asRecord(rec?.payload)
    if (payload?.type !== 'token_count') continue
    const parsed = parseCodexUsageResponse({ rate_limits: payload.rate_limits })
    if (!parsed) continue
    const ts = typeof rec?.timestamp === 'string' ? Date.parse(rec.timestamp) : 0
    if (ts >= latestTs) {
      latestTs = ts
      latest = {
        ...parsed,
        checkedAt: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
        source: 'local-snapshot',
        message: 'codex local token_count snapshot',
      }
    }
  }
  return latest
}

class CodexSession implements AgentSession {
  private ctrl: AbortController | null = null
  constructor(private thread: Thread) {}

  get id(): string {
    return this.thread.id ?? ''
  }

  async *send(prompt: string, opts?: SendOptions): AsyncIterable<AgentEvent> {
    const ctrl = new AbortController()
    this.ctrl = ctrl
    if (opts?.signal) {
      if (opts.signal.aborted) ctrl.abort()
      else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
    }
    let idAnnounced = false
    try {
      const { events } = await this.thread.runStreamed(prompt, { signal: ctrl.signal })
      for await (const ev of events as AsyncGenerator<ThreadEvent>) {
        if (!idAnnounced && ev.type === 'thread.started') {
          idAnnounced = true
          yield { type: 'session-started', sessionId: ev.thread_id }
          continue
        }
        if (ev.type === 'item.completed') {
          const item = ev.item
          if (item.type === 'agent_message') {
            yield { type: 'text', delta: item.text }
          } else if (item.type === 'reasoning') {
            // reasoning summaries are noise for the chat transcript; skip
          } else if (item.type === 'command_execution') {
            yield { type: 'tool-use', name: 'shell', input: item.command }
            if (item.aggregated_output) yield { type: 'tool-result', text: item.aggregated_output }
          } else if (item.type === 'mcp_tool_call') {
            yield { type: 'tool-use', name: `${item.server}.${item.tool}`, input: item.arguments }
          } else if (item.type === 'error') {
            yield { type: 'error', message: item.message }
          }
        } else if (ev.type === 'turn.completed') {
          yield {
            type: 'turn-completed',
            usage: ev.usage,
            metrics: { usage: normalizeUsage('codex', ev.usage) },
          }
        } else if (ev.type === 'turn.failed') {
          yield { type: 'error', message: ev.error.message }
        } else if (ev.type === 'error') {
          yield { type: 'error', message: ev.message }
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) return
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    } finally {
      this.ctrl = null
    }
  }

  abort(): void {
    this.ctrl?.abort()
  }
}

export class CodexAdapter implements AgentSdkAdapter {
  readonly kind = 'codex' as const
  private readonly codex: Codex
  constructor(
    private readonly cwd: string,
    private readonly storageRoot = DEFAULT_CODEX_STORAGE_ROOT,
  ) {
    this.codex = new Codex()
  }

  async createSession(): Promise<AgentSession> {
    return new CodexSession(this.codex.startThread(codexThreadOptions(this.cwd)))
  }

  async resumeSession(id: string): Promise<AgentSession> {
    return new CodexSession(this.codex.resumeThread(id, codexThreadOptions(this.cwd)))
  }

  /** Walk ~/.codex/sessions, keep rollouts whose session_meta.cwd matches this project. */
  async listSessions(): Promise<SessionInfo[]> {
    const files = await this.walkRollouts()
    const titleIndex = await this.readSessionIndex()
    const out: SessionInfo[] = []
    for (const file of files) {
      const meta = await this.readMeta(file, titleIndex)
      if (!meta || meta.cwd !== this.cwd) continue
      out.push({
        id: meta.id,
        title: meta.title,
        kind: this.kind,
        createdAt: meta.ts,
        updatedAt: meta.ts,
      })
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getMessages(id: string): Promise<NormalizedMessage[]> {
    const file = await this.findFileById(id)
    if (!file) return []
    const raw = await readFile(file, 'utf8')
    const out: NormalizedMessage[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: unknown
      try {
        obj = JSON.parse(trimmed)
      } catch {
        continue
      }
      const rec = obj as { type?: string; payload?: Record<string, unknown> }
      if (rec.type !== 'response_item' || !rec.payload) continue
      if (rec.payload.type !== 'message') continue
      const role = rec.payload.role
      if (role !== 'user' && role !== 'assistant') continue
      const parts: MessagePart[] = []
      const content = rec.payload.content
      if (Array.isArray(content)) {
        for (const c of content) {
          const text = (c as { text?: unknown })?.text
          if (typeof text === 'string' && text) {
            const contextKind = role === 'user' ? detectAgentContextKind(text) : undefined
            parts.push(contextKind ? { type: 'text', text, contextKind } : { type: 'text', text })
          }
        }
      }
      if (parts.length) out.push({ role, parts })
    }
    return out
  }

  capabilities(): Capabilities {
    return { listSessions: true, getMessages: true, usageStatus: true }
  }

  async getUsageStatus(): Promise<AgentUsageStatus> {
    const live = await this.readPrivateUsage().catch(() => null)
    if (live) return live
    const snapshot = await this.readLatestUsageSnapshot().catch(() => null)
    if (snapshot) return snapshot
    return {
      kind: this.kind,
      status: 'unavailable',
      checkedAt: Date.now(),
      message:
        'codex usage is unavailable: private API failed and no local token_count snapshot found',
    }
  }

  private async readPrivateUsage(): Promise<AgentUsageStatus | null> {
    const auth = await this.readAuth()
    if (!auth) return null
    const res = await fetch(CODEX_USAGE_URL, {
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'chatgpt-account-id': auth.accountId,
      },
    })
    if (!res.ok) return null
    return parseCodexUsageResponse(await res.json())
  }

  private async readAuth(): Promise<{ accessToken: string; accountId: string } | null> {
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(join(this.storageRoot, 'auth.json'), 'utf8'))
    } catch {
      return null
    }
    const tokens = asRecord(asRecord(raw)?.tokens)
    const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token : ''
    const accountId = typeof tokens?.account_id === 'string' ? tokens.account_id : ''
    return accessToken && accountId ? { accessToken, accountId } : null
  }

  private async readLatestUsageSnapshot(): Promise<AgentUsageStatus | null> {
    let latest: AgentUsageStatus | null = null
    for (const file of await this.walkRollouts()) {
      const parsed = parseCodexTokenCountSnapshot(await readFile(file, 'utf8'))
      if (!parsed) continue
      if (!latest || parsed.checkedAt >= latest.checkedAt) latest = parsed
    }
    return latest
  }

  private async walkRollouts(): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries: Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const full = join(dir, e.name)
        if (e.isDirectory()) await walk(full)
        else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl'))
          out.push(full)
      }
    }
    await walk(join(this.storageRoot, 'sessions'))
    return out
  }

  private async readSessionIndex(): Promise<Map<string, string>> {
    try {
      return parseCodexSessionIndex(
        await readFile(join(this.storageRoot, 'session_index.jsonl'), 'utf8'),
      )
    } catch {
      return new Map()
    }
  }

  private async readMeta(
    file: string,
    titleIndex: Map<string, string>,
  ): Promise<{ id: string; cwd: string; ts: number; title: string } | null> {
    return new Promise((resolve) => {
      let settled = false
      let meta: { id: string; cwd: string; ts: number } | null = null
      let title = ''
      const finish = (v: { id: string; cwd: string; ts: number; title: string } | null) => {
        if (settled) return
        settled = true
        rl.close()
        stream.destroy()
        resolve(v)
      }
      const stream = createReadStream(file, { encoding: 'utf8' })
      stream.on('error', () => finish(null))
      const rl = createInterface({ input: stream })
      rl.on('line', (line) => {
        const t = line.trim()
        if (!t) return
        let obj: unknown
        try {
          obj = JSON.parse(t)
        } catch {
          return
        }
        const rec = obj as { type?: string; payload?: Record<string, unknown> }
        if (rec.type === 'session_meta' && rec.payload) {
          const id = String(rec.payload.id ?? '')
          const cwd = String(rec.payload.cwd ?? '')
          const tsRaw = rec.payload.timestamp
          const ts = typeof tsRaw === 'string' ? Date.parse(tsRaw) : Date.now()
          meta = { id, cwd, ts: Number.isNaN(ts) ? Date.now() : ts }
          return
        }
        if (!meta || title || rec.type !== 'response_item' || !rec.payload) return
        if (rec.payload.type !== 'message' || rec.payload.role !== 'user') return
        const text = textFromMessagePayload(rec.payload)
        if (!text || detectAgentContextKind(text)) return
        title = summarizeCodexPromptForTitle(text)
      })
      rl.on('close', () => {
        if (!meta) finish(null)
        else finish({ ...meta, title: titleIndex.get(meta.id) || title || meta.id })
      })
    })
  }

  private async findFileById(id: string): Promise<string | null> {
    const files = await this.walkRollouts()
    // Rollout filenames embed the session UUID: rollout-<ts>-<uuid>.jsonl
    const match = files.find((f) => f.includes(id))
    if (match) return match
    const titleIndex = await this.readSessionIndex()
    for (const f of files) {
      const meta = await this.readMeta(f, titleIndex)
      if (meta?.id === id) return f
    }
    return null
  }
}
