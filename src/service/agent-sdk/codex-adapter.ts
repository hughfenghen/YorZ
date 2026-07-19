import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'
import { Codex, type Thread, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk'
import type {
  AgentContextKind,
  AgentEvent,
  AgentSdkAdapter,
  AgentSession,
  Capabilities,
  MessagePart,
  NormalizedMessage,
  SendOptions,
  SessionInfo,
} from './types.js'

const SESSIONS_ROOT = join(homedir(), '.codex', 'sessions')

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
  if (
    trimmed.startsWith('<recommended_plugins>') &&
    trimmed.includes('</recommended_plugins>')
  ) {
    return 'recommended_plugins'
  }
  if (
    trimmed.startsWith('# AGENTS.md instructions for ') &&
    trimmed.includes('<INSTRUCTIONS>') &&
    trimmed.includes('</INSTRUCTIONS>')
  ) {
    return 'agents_instructions'
  }
  if (
    trimmed.startsWith('<environment_context>') &&
    trimmed.includes('</environment_context>')
  ) {
    return 'environment_context'
  }
  return undefined
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
          yield { type: 'turn-completed', usage: ev.usage }
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
  constructor(private readonly cwd: string) {
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
    const out: SessionInfo[] = []
    for (const file of files) {
      const meta = await this.readMeta(file)
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
            parts.push(
              contextKind ? { type: 'text', text, contextKind } : { type: 'text', text },
            )
          }
        }
      }
      if (parts.length) out.push({ role, parts })
    }
    return out
  }

  capabilities(): Capabilities {
    return { listSessions: true, getMessages: true }
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
    await walk(SESSIONS_ROOT)
    return out
  }

  private async readMeta(
    file: string,
  ): Promise<{ id: string; cwd: string; ts: number; title: string } | null> {
    return new Promise((resolve) => {
      let settled = false
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
        if (rec.type !== 'session_meta' || !rec.payload) {
          finish(null)
          return
        }
        const id = String(rec.payload.id ?? '')
        const cwd = String(rec.payload.cwd ?? '')
        const tsRaw = rec.payload.timestamp
        const ts = typeof tsRaw === 'string' ? Date.parse(tsRaw) : Date.now()
        finish({ id, cwd, ts: Number.isNaN(ts) ? Date.now() : ts, title: id })
      })
      rl.on('close', () => finish(null))
    })
  }

  private async findFileById(id: string): Promise<string | null> {
    const files = await this.walkRollouts()
    // Rollout filenames embed the session UUID: rollout-<ts>-<uuid>.jsonl
    const match = files.find((f) => f.includes(id))
    if (match) return match
    for (const f of files) {
      const meta = await this.readMeta(f)
      if (meta?.id === id) return f
    }
    return null
  }
}
