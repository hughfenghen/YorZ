export type AgentKind = 'claude' | 'codex' | 'opencode'

export type AgentContextKind = 'recommended_plugins' | 'agents_instructions' | 'environment_context'

/** Normalized streaming event emitted by every adapter's `send()`. */
export type AgentEvent =
  | { type: 'session-started'; sessionId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool-use'; name: string; input: unknown }
  | { type: 'tool-result'; text: string }
  | { type: 'turn-completed'; usage?: unknown }
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
  installCommand?: string
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

/** Uniform contract implemented per Agent SDK (claude / codex / opencode). */
export interface AgentSdkAdapter {
  readonly kind: AgentKind
  /** Create a brand-new session. */
  createSession(opts?: { title?: string }): Promise<AgentSession>
  /** Bind to an existing session id for continued conversation. */
  resumeSession(id: string): Promise<AgentSession>
  /** Enumerate sessions this adapter knows about (native or JSONL-derived). */
  listSessions(): Promise<SessionInfo[]>
  /** Read full normalized history for a session. */
  getMessages(id: string): Promise<NormalizedMessage[]>
  /** Query remaining quota / usage status without mutating a chat transcript. */
  getUsageStatus?(): Promise<AgentUsageStatus>
  capabilities(): Capabilities
  /** Release any long-lived resources (e.g. opencode server). */
  dispose?(): Promise<void>
}
