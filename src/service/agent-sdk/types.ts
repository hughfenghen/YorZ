import type { CompactMetrics, TurnMetrics } from '../telemetry/types.js'

/**
 * Open agent identifier. Was a closed union; now any string so external agents
 * declared in `.yorz/config.json` can register without touching source. The
 * builtin literals live in {@link BUILTIN_AGENT_IDS} as the single source of
 * truth — reference that constant instead of re-typing the literals.
 */
export type AgentId = string

/** The four in-process SDK adapters YorZ ships with. */
export const BUILTIN_AGENT_IDS = ['claude', 'codex', 'opencode', 'pi'] as const
export type BuiltinAgentId = (typeof BUILTIN_AGENT_IDS)[number]

export function isBuiltinAgentId(id: string): id is BuiltinAgentId {
  return (BUILTIN_AGENT_IDS as readonly string[]).includes(id)
}

/**
 * Backwards-compatible alias. Historically a closed union; kept so existing
 * imports keep compiling, but its meaning is now open (see {@link AgentId}).
 */
export type AgentKind = AgentId

/** GUI- and route-facing summary of one agent, builtin or external. */
export interface AgentDescriptor {
  id: AgentId
  displayName: string
  source: 'builtin' | 'external'
  capabilities: Capabilities
}

/** Optional per-session overrides. Omitted fields deliberately defer to the local Agent. */
export interface AgentRuntimeConfig {
  model?: string
  reasoningEffort?: string
}

/** One selectable value exposed by an adapter to settings UIs. */
export interface AgentOption {
  id: string
  displayName: string
}

/** A model plus the reasoning-strength values valid for that model. */
export interface AgentModelOption extends AgentOption {
  reasoningEfforts: AgentOption[]
}

/** Runtime-discovered model choices for one Agent. */
export interface AgentModelCatalog {
  models: AgentModelOption[]
  /** Choices that remain valid when no explicit model is selected. */
  defaultReasoningEfforts: AgentOption[]
}

/** Injected by the host into an external agent's {@link CreateAgentAdapter}. */
export interface AgentAdapterContext {
  cwd: string
  descriptor: AgentDescriptor
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

/** Factory an external agent module must export (default or named). */
export type CreateAgentAdapter = (ctx: AgentAdapterContext) => AgentSdkAdapter

export type AgentContextKind = 'recommended_plugins' | 'agents_instructions' | 'environment_context'

/** Normalized streaming event emitted by every adapter's `send()`. */
export type AgentEvent =
  | { type: 'session-started'; sessionId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool-use'; name: string; input: unknown }
  | { type: 'tool-result'; text: string }
  /**
   * `usage` stays the raw agent-specific payload (the GUI has always received
   * it as such); `metrics` carries the normalized, cross-agent comparable view
   * produced at the adapter boundary.
   */
  | { type: 'turn-completed'; usage?: unknown; metrics?: TurnMetrics }
  /** Context was compacted mid-turn (auto or manual). */
  | { type: 'compact'; metrics: CompactMetrics }
  | { type: 'error'; message: string }

export type MessagePart =
  | { type: 'text'; text: string; contextKind?: AgentContextKind }
  | { type: 'tool-use'; name: string; input: unknown }
  | { type: 'tool-result'; text: string }

/** Normalized, adapter-agnostic conversation message. */
export interface NormalizedMessage {
  role: 'user' | 'assistant'
  parts: MessagePart[]
  ts?: number
}

export interface SessionInfo {
  id: string
  title: string
  kind: AgentKind
  createdAt: number
  updatedAt: number
  /** When set, this session is the dedicated per-spec session for that spec id. */
  specId?: string
  /** Transient list-response state: a turn is currently in flight. Never persisted. */
  running?: boolean
}

export type AgentUsageStatusKind = 'available' | 'unavailable' | 'error'

export interface AgentUsageWindow {
  key: string
  label: string
  utilization: number | null
  resetsAt: string | null
}

export interface AgentUsageStatus {
  kind: AgentKind
  status: AgentUsageStatusKind
  checkedAt: number
  source?: 'native-sdk' | 'private-api' | 'local-snapshot' | 'external-cli'
  subscriptionType?: string | null
  rateLimitsAvailable?: boolean
  windows?: AgentUsageWindow[]
  message?: string
}

export interface Capabilities {
  /** Adapter can enumerate sessions via its own SDK/native store. */
  listSessions: boolean
  /** Adapter can read full history for a session id. */
  getMessages: boolean
  /** Adapter can query account/model usage without sending a chat message. */
  usageStatus: boolean
}

export interface SendOptions {
  signal?: AbortSignal
}

/** A live conversation handle bound to one agent session. */
export interface AgentSession {
  readonly id: string
  /** Send a prompt; yields normalized events until the turn completes. */
  send(prompt: string, opts?: SendOptions): AsyncIterable<AgentEvent>
  /** Cancel the in-flight turn, if any. */
  abort(): void
}

/**
 * Uniform contract implemented per agent, builtin or external. Per the
 * "除了 usageStatus，全部必选" ruling, everything here is MANDATORY except
 * `getUsageStatus`. Method-mandatory ≠ capability-always-on: `capabilities()`
 * still declares which of listSessions/getMessages/usageStatus are actually
 * usable at runtime, so an adapter may implement a required method as a no-op
 * (return `[]`) while declaring the capability `false`.
 */
export interface AgentSdkAdapter {
  readonly kind: AgentId
  /** GUI/route-facing descriptor. `descriptor.id` equals `kind`. */
  readonly descriptor: AgentDescriptor
  /** Create a brand-new session. */
  createSession(opts?: { title?: string } & AgentRuntimeConfig): Promise<AgentSession>
  /** Bind to an existing session id for continued conversation. */
  resumeSession(id: string, runtime?: AgentRuntimeConfig): Promise<AgentSession>
  /** Enumerate sessions this adapter knows about (native or JSONL-derived). */
  listSessions(): Promise<SessionInfo[]>
  /** Read full normalized history for a session. */
  getMessages(id: string): Promise<NormalizedMessage[]>
  capabilities(): Capabilities
  /** Release any long-lived resources (e.g. opencode server). No-op when none. */
  dispose(): Promise<void>
  /**
   * OPTIONAL — enumerate model/reasoning choices available on this machine.
   * Older external adapters may omit it; the host then exposes only the
   * implicit "Agent default" choice.
   */
  listModels?(): Promise<AgentModelCatalog>
  /**
   * OPTIONAL — query remaining quota / usage status
   * without mutating a chat transcript. Omit when the agent has no quota API.
   */
  getUsageStatus?(): Promise<AgentUsageStatus>
}
