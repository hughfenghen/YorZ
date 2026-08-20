import { randomUUID } from 'node:crypto'
import {
  query,
  listSessions,
  getSessionMessages,
  type Options,
  type SDKMessage,
  type SDKControlGetUsageResponse,
} from '@anthropic-ai/claude-agent-sdk'
import { normalizeUsage } from '../telemetry/index.js'
import type { TurnMetrics, UsageSnapshot } from '../telemetry/index.js'
import type {
  AgentEvent,
  AgentSdkAdapter,
  AgentSession,
  AgentUsageStatus,
  AgentUsageWindow,
  Capabilities,
  MessagePart,
  NormalizedMessage,
  SendOptions,
  SessionInfo,
} from './types.js'

interface ContentBlock {
  type?: string
  text?: unknown
  name?: unknown
  input?: unknown
  content?: unknown
}

function blocksFrom(message: unknown): ContentBlock[] {
  if (!message || typeof message !== 'object') return []
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  return Array.isArray(content) ? (content as ContentBlock[]) : []
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    let acc = ''
    for (const c of content) {
      if (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string') {
        acc += (c as { text: string }).text
      } else {
        acc += JSON.stringify(c)
      }
    }
    return acc
  }
  return content == null ? '' : JSON.stringify(content)
}

type UsageWindowKey =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_sonnet'
  | 'seven_day_opus'
  | 'seven_day_oauth_apps'

const USAGE_WINDOWS: Array<[UsageWindowKey, string]> = [
  ['five_hour', '5-hour'],
  ['seven_day', '7-day'],
  ['seven_day_sonnet', 'Sonnet 7-day'],
  ['seven_day_opus', 'Opus 7-day'],
  ['seven_day_oauth_apps', 'OAuth apps 7-day'],
]

function usageWindows(usage: SDKControlGetUsageResponse): AgentUsageWindow[] {
  const out: AgentUsageWindow[] = []
  const limits = usage.rate_limits
  if (!limits) return out
  for (const [key, label] of USAGE_WINDOWS) {
    const win = limits[key]
    if (!win) continue
    out.push({
      key,
      label,
      utilization: typeof win.utilization === 'number' ? win.utilization : null,
      resetsAt: typeof win.resets_at === 'string' ? win.resets_at : null,
    })
  }
  for (const win of limits.model_scoped ?? []) {
    out.push({
      key: `model:${win.display_name}`,
      label: win.display_name,
      utilization: typeof win.utilization === 'number' ? win.utilization : null,
      resetsAt: typeof win.resets_at === 'string' ? win.resets_at : null,
    })
  }
  return out
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Attach the run's cost to the usage snapshot without inventing a snapshot. */
function withCost(usage: UsageSnapshot | undefined, costUsd?: number): UsageSnapshot | undefined {
  if (costUsd === undefined) return usage
  return { ...(usage ?? {}), costUsd }
}

/** `modelUsage` is keyed by model id; the busiest key names the turn's model. */
function primaryModel(modelUsage: unknown): string | undefined {
  if (!isRecord(modelUsage)) return undefined
  let best: string | undefined
  let bestOutput = -1
  for (const [model, raw] of Object.entries(modelUsage)) {
    const output = isRecord(raw) ? (num(raw.outputTokens) ?? 0) : 0
    if (output > bestOutput) {
      bestOutput = output
      best = model
    }
  }
  return best
}

class ClaudeSession implements AgentSession {
  private started = false
  private ctrl: AbortController | null = null
  constructor(
    public id: string,
    private readonly cwd: string,
    private readonly isNew: boolean,
  ) {}

  async *send(prompt: string, opts?: SendOptions): AsyncIterable<AgentEvent> {
    const ctrl = new AbortController()
    this.ctrl = ctrl
    if (opts?.signal) {
      if (opts.signal.aborted) ctrl.abort()
      else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
    }
    const options: Options = {
      cwd: this.cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController: ctrl,
    }
    if (this.isNew && !this.started) options.sessionId = this.id
    else options.resume = this.id

    try {
      const q = query({ prompt, options })
      let usage: unknown
      let metrics: TurnMetrics | undefined
      let completed = false
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        const m = msg as {
          type: string
          subtype?: string
          state?: string
          session_id?: string
          message?: unknown
          usage?: unknown
          total_cost_usd?: unknown
          modelUsage?: unknown
          num_turns?: unknown
          stop_reason?: unknown
          duration_ms?: unknown
          duration_api_ms?: unknown
          compact_metadata?: {
            trigger?: unknown
            pre_tokens?: unknown
            post_tokens?: unknown
            duration_ms?: unknown
          }
        }
        if (!this.started && typeof m.session_id === 'string') {
          this.started = true
          if (m.session_id !== this.id) this.id = m.session_id
          yield { type: 'session-started', sessionId: this.id }
        }
        if (m.type === 'assistant') {
          for (const b of blocksFrom(m.message)) {
            if (b.type === 'text' && typeof b.text === 'string') {
              yield { type: 'text', delta: b.text }
            } else if (b.type === 'tool_use') {
              yield { type: 'tool-use', name: String(b.name ?? '?'), input: b.input ?? {} }
            }
          }
        } else if (m.type === 'user') {
          for (const b of blocksFrom(m.message)) {
            if (b.type === 'tool_result') {
              yield { type: 'tool-result', text: toolResultText(b.content) }
            }
          }
        } else if (m.type === 'result') {
          usage = m.usage
          // The SDK reports cost / model split / turn count on the SAME message
          // it reports `usage` on; capturing only `usage` threw the rest away.
          // These numbers scope to this `query()` call, not the whole session
          // (the session-cumulative view is a separate `get_usage` control
          // request), so callers may sum them across dispatches directly.
          metrics = {
            usage: withCost(normalizeUsage('claude', m.usage), num(m.total_cost_usd)),
            modelUsage: isRecord(m.modelUsage) ? m.modelUsage : undefined,
            numTurns: num(m.num_turns),
            stopReason: typeof m.stop_reason === 'string' ? m.stop_reason : undefined,
            model: primaryModel(m.modelUsage),
            durationMs: num(m.duration_ms),
            apiDurationMs: num(m.duration_api_ms),
          }
        } else if (m.type === 'system' && m.subtype === 'compact_boundary') {
          // Auto-compaction used to be entirely invisible, yet it is the single
          // biggest step change in a session's token profile.
          const meta = m.compact_metadata ?? {}
          yield {
            type: 'compact',
            metrics: {
              trigger: meta.trigger === 'manual' || meta.trigger === 'auto' ? meta.trigger : undefined,
              preTokens: num(meta.pre_tokens),
              postTokens: num(meta.post_tokens),
              durationMs: num(meta.duration_ms),
            },
          }
        } else if (
          m.type === 'system' &&
          m.subtype === 'session_state_changed' &&
          m.state === 'idle'
        ) {
          completed = true
          yield { type: 'turn-completed', usage, metrics }
        }
      }
      if (!completed) yield { type: 'turn-completed', usage, metrics }
    } catch (err) {
      if (ctrl.signal.aborted) return
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    } finally {
      this.started = true
      this.ctrl = null
    }
  }

  abort(): void {
    this.ctrl?.abort()
  }
}

export class ClaudeAdapter implements AgentSdkAdapter {
  readonly kind = 'claude' as const
  constructor(private readonly cwd: string) {}

  async createSession(): Promise<AgentSession> {
    return new ClaudeSession(randomUUID(), this.cwd, true)
  }

  async resumeSession(id: string): Promise<AgentSession> {
    return new ClaudeSession(id, this.cwd, false)
  }

  async listSessions(): Promise<SessionInfo[]> {
    const infos = await listSessions({ dir: this.cwd, includeWorktrees: false })
    return infos.map((s) => ({
      id: s.sessionId,
      title: s.customTitle ?? s.summary ?? s.firstPrompt ?? s.sessionId,
      kind: this.kind,
      createdAt: s.lastModified,
      updatedAt: s.lastModified,
    }))
  }

  async getMessages(id: string): Promise<NormalizedMessage[]> {
    const raw = await getSessionMessages(id, { dir: this.cwd })
    const out: NormalizedMessage[] = []
    for (const entry of raw) {
      if (entry.type !== 'user' && entry.type !== 'assistant') continue
      const parts: MessagePart[] = []
      for (const b of blocksFrom(entry.message)) {
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push({ type: 'text', text: b.text })
        } else if (b.type === 'tool_use') {
          parts.push({ type: 'tool-use', name: String(b.name ?? '?'), input: b.input ?? {} })
        } else if (b.type === 'tool_result') {
          parts.push({ type: 'tool-result', text: toolResultText(b.content) })
        }
      }
      if (parts.length) out.push({ role: entry.type, parts })
    }
    return out
  }

  capabilities(): Capabilities {
    return { listSessions: true, getMessages: true, usageStatus: true }
  }

  async getUsageStatus(): Promise<AgentUsageStatus> {
    const options: Options = {
      cwd: this.cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    }
    const q = query({ prompt: '', options })
    try {
      const usage = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
      q.close()
      return {
        kind: this.kind,
        status: usage.rate_limits_available ? 'available' : 'unavailable',
        checkedAt: Date.now(),
        subscriptionType: usage.subscription_type,
        rateLimitsAvailable: usage.rate_limits_available,
        windows: usageWindows(usage),
        message: usage.rate_limits_available
          ? undefined
          : 'claude usage rate limits are unavailable for this auth/provider',
      }
    } catch (err) {
      q.close()
      return {
        kind: this.kind,
        status: 'error',
        checkedAt: Date.now(),
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
