import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager as PiSessionManager,
  type AgentSession as PiAgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
  type SessionEntry,
  type SessionInfo as PiSessionInfo,
} from '@earendil-works/pi-coding-agent'
import { normalizeUsage } from '../telemetry/index.js'
import type { PhaseUsageSnapshot, TurnMetrics } from '../telemetry/index.js'
import { summarizeCodexPromptForTitle as summarizePromptForTitle } from './codex-adapter.js'
import { PhaseAccumulator, isSpecWrite } from './phase-usage.js'
import type {
  AgentDescriptor,
  AgentEvent,
  AgentModelCatalog,
  AgentRuntimeConfig,
  AgentSdkAdapter,
  AgentSession,
  Capabilities,
  MessagePart,
  NormalizedMessage,
  SendOptions,
  SessionInfo,
} from './types.js'

/**
 * Pi's own `Usage`, kept in its native shape.
 *
 * The `usage` field of a `turn-completed` event has always carried the agent's
 * raw payload; `normalizeUsage('pi', …)` is what produces the comparable view.
 */
interface PiUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  cacheWrite1h?: number
  reasoning?: number
  totalTokens?: number
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    total?: number
  }
}

interface PiAdapterOptions {
  /** Pi global config dir. Defaults to `~/.pi/agent`. Injectable for tests. */
  agentDir?: string
  /** Session JSONL dir. Defaults to `<agentDir>/sessions/<encoded-cwd>/`. */
  sessionDir?: string
}

const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

function isPiThinkingLevel(
  value: string | undefined,
): value is NonNullable<CreateAgentSessionOptions['thinkingLevel']> {
  return PI_THINKING_LEVELS.some((item) => item === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Flatten Pi's `(TextContent | ImageContent | ToolCall | ThinkingContent)[]` to text. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let acc = ''
  for (const c of content) {
    if (isRecord(c) && c.type === 'text' && typeof c.text === 'string') acc += c.text
  }
  return acc
}

/** Tool results arrive as content blocks; the chat panel only renders text. */
function toolResultText(result: unknown): string {
  if (typeof result === 'string') return result
  if (Array.isArray(result)) return contentText(result)
  if (isRecord(result)) {
    const inner = contentText(result.content)
    if (inner) return inner
    if (typeof result.output === 'string') return result.output
  }
  return result == null ? '' : JSON.stringify(result)
}

/**
 * Sum Pi usage payloads in Pi's own shape.
 *
 * Pi reports usage per assistant message, not once per turn, so the raw
 * `turn-completed.usage` has to be assembled here. Summing in the native shape
 * (rather than summing normalized snapshots) keeps `usage` a faithful Pi
 * payload for consumers that already read it as such.
 */
function addUsage(acc: PiUsage, raw: unknown): void {
  if (!isRecord(raw)) return
  for (const key of [
    'input',
    'output',
    'cacheRead',
    'cacheWrite',
    'cacheWrite1h',
    'reasoning',
    'totalTokens',
  ] as const) {
    const value = num(raw[key])
    if (value === undefined) continue
    acc[key] = (acc[key] ?? 0) + value
  }
  const cost = raw.cost
  if (!isRecord(cost)) return
  const target = (acc.cost ??= {})
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) {
    const value = num(cost[key])
    if (value === undefined) continue
    target[key] = (target[key] ?? 0) + value
  }
}

function hasUsage(usage: PiUsage): boolean {
  return Object.keys(usage).length > 0
}

/**
 * Bridges Pi's push-based `subscribe(listener)` onto the pull-based
 * `AsyncIterable` that `AgentSession.send()` must return.
 *
 * The listener only enqueues and wakes a parked consumer; all mapping happens
 * on the consumer side, so a slow chat client can never stall Pi's agent loop.
 */
class EventQueue<T> {
  private items: T[] = []
  private wake: (() => void) | null = null
  private closed = false

  push(item: T): void {
    this.items.push(item)
    this.notify()
  }

  /** Stop after the already-queued items drain — never discards them. */
  close(): void {
    this.closed = true
    this.notify()
  }

  private notify(): void {
    const resume = this.wake
    this.wake = null
    resume?.()
  }

  async *drain(): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length) yield this.items.shift() as T
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }
}

class PiSession implements AgentSession {
  private started = false
  private live: PiAgentSession | null = null
  private aborted = false

  constructor(
    public id: string,
    private readonly cwd: string,
    private readonly isNew: boolean,
    private readonly adapter: PiAdapter,
    private readonly runtime: AgentRuntimeConfig = {},
  ) {}

  /**
   * One Pi session per turn.
   *
   * `AgentSession` has no release hook, so a long-lived `PiAgentSession` would
   * leak its listeners and extension runtime for as long as the chat exists.
   * The expensive part — model catalog and auth — is hoisted into the adapter's
   * shared `ModelRuntime`, leaving per-turn setup cheap.
   */
  async *send(prompt: string, opts?: SendOptions): AsyncIterable<AgentEvent> {
    this.aborted = false
    if (opts?.signal) {
      if (opts.signal.aborted) return
      opts.signal.addEventListener('abort', () => this.abort(), { once: true })
    }

    const phase = new PhaseAccumulator('pi', Date.now())
    let planPhase: PhaseUsageSnapshot | undefined
    const usage: PiUsage = {}
    let model: string | undefined
    let stopReason: string | undefined
    let turns = 0
    let compactionStartedAt = 0
    const startedAt = Date.now()

    let session: PiAgentSession
    let resumeError: string | undefined
    try {
      const resolved = await this.openPiSession()
      session = resolved.session
      resumeError = resolved.resumeError
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
      return
    }
    this.live = session

    if (resumeError) yield { type: 'error', message: resumeError }
    if (!this.started || session.sessionId !== this.id) {
      this.started = true
      this.id = session.sessionId
      yield { type: 'session-started', sessionId: this.id }
    }

    const queue = new EventQueue<AgentSessionEvent>()
    const unsubscribe = session.subscribe((event) => queue.push(event))
    let promptError: unknown
    const running = session
      .prompt(prompt, { expandPromptTemplates: false })
      .catch((err: unknown) => {
        promptError = err
      })
      .finally(() => queue.close())

    try {
      for await (const event of queue.drain()) {
        switch (event.type) {
          case 'message_update': {
            const delta = event.assistantMessageEvent
            // `thinking_delta` is dropped on purpose: reasoning traces are noise
            // in the transcript, matching how the codex adapter treats them.
            if (delta.type === 'text_delta' && delta.delta) {
              yield { type: 'text', delta: delta.delta }
            }
            break
          }
          case 'message_end': {
            const message = event.message as unknown
            if (isRecord(message) && message.role === 'assistant') {
              phase.add(message.usage)
              addUsage(usage, message.usage)
              if (typeof message.model === 'string') model = message.model
              if (typeof message.stopReason === 'string') stopReason = message.stopReason
              if (message.stopReason === 'error') {
                const detail =
                  typeof message.errorMessage === 'string' && message.errorMessage
                    ? message.errorMessage
                    : 'pi assistant turn failed'
                yield { type: 'error', message: detail }
              }
            }
            break
          }
          case 'turn_end':
            turns += 1
            break
          case 'tool_execution_start': {
            // Snapshot *after* the request that decided on this call was
            // accumulated: writing the spec back is the plan phase's own
            // output, not execution's first cost.
            if (!planPhase && isSpecWrite('pi', event.toolName, event.args)) {
              planPhase = phase.snapshot()
            }
            yield { type: 'tool-use', name: event.toolName, input: event.args ?? {} }
            break
          }
          case 'tool_execution_end': {
            const text = toolResultText(event.result)
            if (text) yield { type: 'tool-result', text }
            break
          }
          case 'compaction_start':
            compactionStartedAt = Date.now()
            break
          case 'compaction_end': {
            // Emitted only on `_end`: `_start` has no token counts, so pairing
            // both would publish one metric-less boundary per compaction.
            if (event.aborted) break
            if (event.errorMessage) {
              yield { type: 'error', message: event.errorMessage }
              break
            }
            yield {
              type: 'compact',
              metrics: {
                trigger: event.reason === 'manual' ? 'manual' : 'auto',
                preTokens: num(event.result?.tokensBefore),
                postTokens: num(event.result?.estimatedTokensAfter),
                durationMs: compactionStartedAt ? Date.now() - compactionStartedAt : undefined,
              },
            }
            break
          }
          default:
            break
        }
      }
      await running

      if (this.aborted) return
      if (promptError) {
        yield {
          type: 'error',
          message: promptError instanceof Error ? promptError.message : String(promptError),
        }
        return
      }

      const metrics: TurnMetrics = {
        usage: normalizeUsage('pi', usage),
        numTurns: turns || undefined,
        stopReason,
        model,
        durationMs: Date.now() - startedAt,
        planPhase,
        observedTotal: phase.snapshot(),
      }
      yield { type: 'turn-completed', usage: hasUsage(usage) ? usage : undefined, metrics }
    } finally {
      unsubscribe()
      session.dispose()
      this.live = null
      this.started = true
    }
  }

  abort(): void {
    this.aborted = true
    void this.live?.abort()
  }

  /** Build (or reopen) the Pi session backing this turn. */
  private async openPiSession(): Promise<{ session: PiAgentSession; resumeError?: string }> {
    let resumeError: string | undefined
    let manager: PiSessionManager
    if (this.isNew && !this.started) {
      manager = PiSessionManager.create(this.cwd, this.adapter.sessionDirOption, { id: this.id })
    } else {
      const path = await this.adapter.resolveSessionPath(this.id)
      if (path) {
        manager = PiSessionManager.open(path, this.adapter.sessionDirOption, this.cwd)
      } else {
        // Falling back to a fresh session beats failing the whole turn, but it
        // silently changes which transcript the user is talking to — say so.
        resumeError = `pi session ${this.id} was not found on disk; started a new session instead`
        manager = PiSessionManager.create(this.cwd, this.adapter.sessionDirOption)
      }
    }
    const modelRuntime = await this.adapter.ensureRuntime()
    const model = this.runtime.model
      ? this.adapter.resolveModel(modelRuntime, this.runtime.model)
      : undefined
    const { session } = await createAgentSession({
      cwd: this.cwd,
      agentDir: this.adapter.agentDirOption,
      modelRuntime,
      sessionManager: manager,
      ...(model ? { model } : {}),
      ...(isPiThinkingLevel(this.runtime.reasoningEffort)
        ? { thinkingLevel: this.runtime.reasoningEffort }
        : {}),
    })
    return { session, resumeError }
  }
}

export class PiAdapter implements AgentSdkAdapter {
  readonly kind = 'pi' as const
  readonly descriptor: AgentDescriptor = {
    id: 'pi',
    displayName: 'Pi',
    source: 'builtin',
    capabilities: { listSessions: true, getMessages: true, usageStatus: false },
  }
  private runtime: Promise<ModelRuntime> | null = null
  /** `session id → JSONL path`, refreshed from disk on a miss. */
  private readonly pathIndex = new Map<string, string>()

  constructor(
    private readonly cwd: string,
    private readonly opts: PiAdapterOptions = {},
  ) {}

  get agentDirOption(): string | undefined {
    return this.opts.agentDir
  }

  get sessionDirOption(): string | undefined {
    return this.opts.sessionDir
  }

  /**
   * Lazily build one `ModelRuntime` for every session this adapter serves.
   *
   * Creating it reads auth and the model catalog — the dominant cost of
   * `createAgentSession()`. On failure the memo is cleared so the next turn
   * retries instead of replaying a cached rejection forever.
   */
  async ensureRuntime(): Promise<ModelRuntime> {
    if (!this.runtime) {
      const agentDir = this.opts.agentDir
      this.runtime = ModelRuntime.create(
        agentDir
          ? { authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json') }
          : undefined,
      ).catch((err: unknown) => {
        this.runtime = null
        throw err
      })
    }
    return this.runtime
  }

  resolveModel(runtime: ModelRuntime, id: string): ReturnType<ModelRuntime['getModel']> {
    const slash = id.indexOf('/')
    if (slash <= 0 || slash === id.length - 1) return undefined
    return runtime.getModel(id.slice(0, slash), id.slice(slash + 1))
  }

  async createSession(opts?: { title?: string } & AgentRuntimeConfig): Promise<AgentSession> {
    return new PiSession(randomUUID(), this.cwd, true, this, opts)
  }

  async resumeSession(id: string, runtime?: AgentRuntimeConfig): Promise<AgentSession> {
    return new PiSession(id, this.cwd, false, this, runtime)
  }

  async listModels(): Promise<AgentModelCatalog> {
    const runtime = await this.ensureRuntime()
    const models = await runtime.getAvailable()
    return {
      models: models.map((model) => ({
        id: `${model.provider}/${model.id}`,
        displayName: `${model.provider} · ${model.name || model.id}`,
        reasoningEfforts: model.reasoning
          ? PI_THINKING_LEVELS.map((id) => ({ id, displayName: id }))
          : [],
      })),
      defaultReasoningEfforts: PI_THINKING_LEVELS.map((id) => ({ id, displayName: id })),
    }
  }

  async listSessions(): Promise<SessionInfo[]> {
    const infos = await this.listPiSessions()
    return infos
      .map((info) => ({
        id: info.id,
        title: this.titleOf(info),
        kind: this.kind,
        createdAt: info.created.getTime(),
        updatedAt: info.modified.getTime(),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getMessages(id: string): Promise<NormalizedMessage[]> {
    const path = await this.resolveSessionPath(id)
    if (!path) return []
    let entries: SessionEntry[]
    try {
      entries = PiSessionManager.open(path, this.opts.sessionDir, this.cwd).getEntries()
    } catch {
      return []
    }
    const out: NormalizedMessage[] = []
    for (const entry of entries) {
      if (entry.type !== 'message') continue
      const message = entry.message as unknown
      if (!isRecord(message)) continue
      const ts = num(message.timestamp)
      if (message.role === 'user') {
        const text = contentText(message.content)
        if (text) out.push({ role: 'user', parts: [{ type: 'text', text }], ts })
      } else if (message.role === 'assistant') {
        const parts: MessagePart[] = []
        const content = Array.isArray(message.content) ? message.content : []
        for (const block of content) {
          if (!isRecord(block)) continue
          // `thinking` blocks are dropped, mirroring the live stream mapping.
          if (block.type === 'text' && typeof block.text === 'string' && block.text) {
            parts.push({ type: 'text', text: block.text })
          } else if (block.type === 'toolCall') {
            parts.push({
              type: 'tool-use',
              name: String(block.name ?? '?'),
              input: block.arguments ?? {},
            })
          }
        }
        if (parts.length) out.push({ role: 'assistant', parts, ts })
      } else if (message.role === 'toolResult') {
        // Pi models tool results as their own role. Folding them into the
        // preceding assistant message matches how the chat panel reads a tool
        // call and its output as one exchange.
        const text = toolResultText(message.content)
        if (!text) continue
        const last = out[out.length - 1]
        if (last?.role === 'assistant') last.parts.push({ type: 'tool-result', text })
      }
    }
    return out
  }

  /**
   * `usageStatus: false` — Pi is BYO-provider: `ModelRuntime` knows whether auth
   * is configured but has no quota window to report. Declaring it unsupported
   * lets the GUI render nothing, which beats a probe that must always fail.
   */
  capabilities(): Capabilities {
    return this.descriptor.capabilities
  }

  async dispose(): Promise<void> {
    // No child process to stop — dropping the runtime reference is the whole
    // release path.
    this.runtime = null
    this.pathIndex.clear()
  }

  /** Resolve a session id to its JSONL path, refreshing the index on a miss. */
  async resolveSessionPath(id: string): Promise<string | null> {
    const cached = this.pathIndex.get(id)
    if (cached) return cached
    await this.listPiSessions()
    return this.pathIndex.get(id) ?? null
  }

  private async listPiSessions(): Promise<PiSessionInfo[]> {
    let infos: PiSessionInfo[]
    try {
      infos = await PiSessionManager.list(this.cwd, this.opts.sessionDir)
    } catch {
      return []
    }
    // `list` buckets by encoded cwd already; this second pass catches sessions
    // written before the header carried a cwd (empty string) versus ones that
    // genuinely belong to another project.
    const mine = infos.filter((info) => !info.cwd || info.cwd === this.cwd)
    for (const info of mine) this.pathIndex.set(info.id, info.path)
    return mine
  }

  private titleOf(info: PiSessionInfo): string {
    if (info.name?.trim()) return info.name.trim()
    const summarized = info.firstMessage ? summarizePromptForTitle(info.firstMessage) : ''
    return summarized || info.id
  }
}
