import type { GitChange } from './api.js'

function projectBase(pid: string): string {
  return `/api/projects/${encodeURIComponent(pid)}`
}

export type AgentMode = 'skill-run' | 'explain' | 'review' | 'git-ops'
export type GitOpsAction = 'commit' | 'discard' | 'stash'

export interface AgentStdoutEvent {
  runId: string
  mode: AgentMode
  specId: string
  chunk: string
}
export interface AgentExitEvent {
  runId: string
  mode: AgentMode
  specId: string
  code: number | null
}
export interface AgentErrorEvent {
  runId: string
  mode: AgentMode
  specId: string
  message: string
}
export interface ServerHeartbeatEvent {
  ts: number
}

// The unsubscribe function returned by subscribe*() also carries a `readyState`
// probe so callers (e.g. the agent-tasks watchdog) can tell whether the
// underlying EventSource is currently OPEN.
export interface SseSubscription {
  (): void
  readyState: () => number
}

// =============================================================================
// Multiplexed SSE
// =============================================================================
//
// All realtime events go through ONE EventSource per tab. Callers subscribe to
// named "topics" — the mux batches topic changes into a single POST to
// `/api/events/subscribe`, and dispatches incoming `msg` frames to the
// registered handlers by topic.
//
// Motivation: browsers cap HTTP/1.1 connections at 6 per origin. Opening
// several tabs / SSE-heavy pages used to saturate the budget and leave later
// `fetch` calls perpetually pending.

type TopicHandler = (event: string, data: unknown) => void

function generateClientId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

class SseMultiplex {
  private clientId = generateClientId()
  private source: EventSource | null = null
  private handlers = new Map<string, Set<TopicHandler>>()
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private syncInFlight = false
  private syncPending = false

  subscribe(topic: string, handler: TopicHandler): () => void {
    let set = this.handlers.get(topic)
    if (!set) {
      set = new Set()
      this.handlers.set(topic, set)
    }
    set.add(handler)
    this.ensureOpen()
    this.scheduleSync()
    return () => {
      const s = this.handlers.get(topic)
      if (!s) return
      s.delete(handler)
      if (s.size === 0) this.handlers.delete(topic)
      this.scheduleSync()
    }
  }

  readyState(): number {
    return this.source?.readyState ?? 2 // EventSource.CLOSED
  }

  private ensureOpen(): void {
    if (this.source) return
    const url = `/api/events/stream?clientId=${encodeURIComponent(this.clientId)}`
    const source = new EventSource(url)
    this.source = source
    source.addEventListener('open', () => {
      // On (re)connect the server has a fresh session — flush our topics.
      this.scheduleSync(true)
    })
    source.addEventListener('server-heartbeat', (e) => {
      let data: unknown = { ts: Date.now() }
      try {
        data = JSON.parse((e as MessageEvent).data)
      } catch {
        // keep fallback
      }
      // Dispatch heartbeat to every subscribed handler — the watchdog uses it
      // to refresh lastEventAt regardless of topic.
      for (const set of this.handlers.values()) {
        for (const h of set) {
          try {
            h('server-heartbeat', data)
          } catch {
            // handler errors must not break dispatch
          }
        }
      }
    })
    source.addEventListener('msg', (e) => {
      let payload: { topic: string; event: string; data: unknown }
      try {
        payload = JSON.parse((e as MessageEvent).data)
      } catch {
        return
      }
      const set = this.handlers.get(payload.topic)
      if (!set) return
      for (const h of set) {
        try {
          h(payload.event, payload.data)
        } catch {
          // handler errors must not break dispatch
        }
      }
    })
    source.addEventListener('error', () => {
      // EventSource auto-reconnects; no-op
    })
  }

  private scheduleSync(immediate: boolean = false): void {
    if (this.syncTimer) return
    const delay = immediate ? 0 : 20
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      void this.runSync()
    }, delay)
  }

  private async runSync(): Promise<void> {
    if (this.syncInFlight) {
      this.syncPending = true
      return
    }
    this.syncInFlight = true
    try {
      const topics = [...this.handlers.keys()].sort()
      await fetch('/api/events/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: this.clientId, topics }),
      })
    } catch {
      // network error; a later scheduleSync (or reconnect open) will retry
    } finally {
      this.syncInFlight = false
      if (this.syncPending) {
        this.syncPending = false
        this.scheduleSync(true)
      }
    }
  }
}

// Overridable for tests (mux is stateful and would leak across cases otherwise).
let mux = new SseMultiplex()
export function __resetMuxForTests(): void {
  mux = new SseMultiplex()
}

function makeSubscription(unsubscribe: () => void): SseSubscription {
  const s = unsubscribe as SseSubscription
  s.readyState = () => mux.readyState()
  return s
}

// =============================================================================
// Public subscription API (kept intentionally identical to the pre-mux version)
// =============================================================================

export interface SpecSubscribeHandlers {
  onUpdated?: () => void
  onAgentStdout?: (e: AgentStdoutEvent) => void
  onAgentExit?: (e: AgentExitEvent) => void
  onAgentError?: (e: AgentErrorEvent) => void
  onServerHeartbeat?: (e: ServerHeartbeatEvent) => void
}

export function subscribeSpec(
  pid: string,
  id: string,
  handlers: SpecSubscribeHandlers,
): SseSubscription {
  if (!pid) {
    const noop = (() => {}) as SseSubscription
    noop.readyState = () => 2
    return noop
  }
  const topic = `project:${pid}:spec:${id}`
  const unsub = mux.subscribe(topic, (event, data) => {
    switch (event) {
      case 'updated':
        handlers.onUpdated?.()
        break
      case 'agent-stdout':
        handlers.onAgentStdout?.(data as AgentStdoutEvent)
        break
      case 'agent-exit':
        handlers.onAgentExit?.(data as AgentExitEvent)
        break
      case 'agent-error':
        handlers.onAgentError?.(data as AgentErrorEvent)
        break
      case 'server-heartbeat':
        handlers.onServerHeartbeat?.(data as ServerHeartbeatEvent)
        break
    }
  })
  return makeSubscription(unsub)
}

export interface RunSubscribeHandlers {
  onAgentStdout?: (e: AgentStdoutEvent) => void
  onAgentExit?: (e: AgentExitEvent) => void
  onAgentError?: (e: AgentErrorEvent) => void
  onServerHeartbeat?: (e: ServerHeartbeatEvent) => void
}

export function subscribeRun(
  pid: string,
  runId: string,
  handlers: RunSubscribeHandlers,
): SseSubscription {
  if (!pid) {
    const noop = (() => {}) as SseSubscription
    noop.readyState = () => 2
    return noop
  }
  const topic = `project:${pid}:run:${runId}`
  const unsub = mux.subscribe(topic, (event, data) => {
    switch (event) {
      case 'agent-stdout':
        handlers.onAgentStdout?.(data as AgentStdoutEvent)
        break
      case 'agent-exit':
        handlers.onAgentExit?.(data as AgentExitEvent)
        break
      case 'agent-error':
        handlers.onAgentError?.(data as AgentErrorEvent)
        break
      case 'server-heartbeat':
        handlers.onServerHeartbeat?.(data as ServerHeartbeatEvent)
        break
    }
  })
  return makeSubscription(unsub)
}

export function subscribeSpecsList(pid: string, onChange: () => void): () => void {
  if (!pid) return () => {}
  const topic = `project:${pid}:specs`
  return mux.subscribe(topic, (event) => {
    if (event === 'list-updated') onChange()
  })
}

export function subscribeProjectsList(onChange: () => void): () => void {
  return mux.subscribe('projects', (event) => {
    if (event === 'projects-changed') onChange()
  })
}

export function subscribeChanges(
  pid: string,
  id: string,
  onUpdate: (changes: GitChange[]) => void,
): SseSubscription {
  if (!pid) {
    const noop = (() => {}) as SseSubscription
    noop.readyState = () => 2
    return noop
  }
  const topic = `project:${pid}:spec:${id}:changes`
  const unsub = mux.subscribe(topic, (event, data) => {
    if (event === 'changes-updated') {
      const payload = data as { changes: GitChange[] }
      onUpdate(payload.changes)
    }
  })
  return makeSubscription(unsub)
}

export interface ActiveRunInfo {
  runId: string
  mode: AgentMode
  specId: string
  startedAt: number
  action?: GitOpsAction
}

export async function fetchActiveRuns(pid: string): Promise<ActiveRunInfo[]> {
  if (!pid) return []
  const res = await fetch(`${projectBase(pid)}/runs`)
  if (!res.ok) return []
  try {
    return (await res.json()) as ActiveRunInfo[]
  } catch {
    return []
  }
}

export async function cancelRun(pid: string, runId: string): Promise<void> {
  if (!pid) return
  try {
    await fetch(`${projectBase(pid)}/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
  } catch {
    // network errors / 404 (run already ended) are non-fatal
  }
}
