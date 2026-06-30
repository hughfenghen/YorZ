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

function noopSubscription(): SseSubscription {
  const unsub = (() => {
    /* no-op */
  }) as SseSubscription
  unsub.readyState = () => 2 // EventSource.CLOSED
  return unsub
}

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
  if (!pid) return noopSubscription()
  const source = new EventSource(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/events`)
  const onUpdated = () => handlers.onUpdated?.()
  const onAgentStdout = (e: MessageEvent) => {
    try {
      handlers.onAgentStdout?.(JSON.parse(e.data))
    } catch {
      // ignore
    }
  }
  const onAgentExit = (e: MessageEvent) => {
    try {
      handlers.onAgentExit?.(JSON.parse(e.data))
    } catch {
      // ignore
    }
  }
  const onAgentError = (e: MessageEvent) => {
    try {
      handlers.onAgentError?.(JSON.parse(e.data))
    } catch {
      // ignore
    }
  }
  const onServerHeartbeat = (e: MessageEvent) => {
    try {
      handlers.onServerHeartbeat?.(JSON.parse(e.data))
    } catch {
      // ignore
    }
  }

  source.addEventListener('updated', onUpdated)
  source.addEventListener('agent-stdout', onAgentStdout)
  source.addEventListener('agent-exit', onAgentExit)
  source.addEventListener('agent-error', onAgentError)
  source.addEventListener('server-heartbeat', onServerHeartbeat)
  source.addEventListener('error', () => {
    // EventSource auto-reconnects; no-op
  })

  const unsubscribe = (() => {
    source.removeEventListener('updated', onUpdated)
    source.removeEventListener('agent-stdout', onAgentStdout)
    source.removeEventListener('agent-exit', onAgentExit)
    source.removeEventListener('agent-error', onAgentError)
    source.removeEventListener('server-heartbeat', onServerHeartbeat)
    source.close()
  }) as SseSubscription
  unsubscribe.readyState = () => source.readyState
  return unsubscribe
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
  if (!pid) return noopSubscription()
  const source = new EventSource(`${projectBase(pid)}/runs/${encodeURIComponent(runId)}/events`)
  const onStdout = (e: MessageEvent) => {
    try {
      handlers.onAgentStdout?.(JSON.parse(e.data))
    } catch {
      // ignore
    }
  }
  const onExit = (e: MessageEvent) => {
    try {
      handlers.onAgentExit?.(JSON.parse(e.data))
    } catch {
      // ignore
    }
  }
  const onError = (e: MessageEvent) => {
    try {
      handlers.onAgentError?.(JSON.parse(e.data))
    } catch {
      // ignore
    }
  }
  const onServerHeartbeat = (e: MessageEvent) => {
    try {
      handlers.onServerHeartbeat?.(JSON.parse(e.data))
    } catch {
      // ignore
    }
  }
  source.addEventListener('agent-stdout', onStdout)
  source.addEventListener('agent-exit', onExit)
  source.addEventListener('agent-error', onError)
  source.addEventListener('server-heartbeat', onServerHeartbeat)
  source.addEventListener('error', () => {
    // EventSource auto-reconnects; no-op
  })
  const unsubscribe = (() => {
    source.removeEventListener('agent-stdout', onStdout)
    source.removeEventListener('agent-exit', onExit)
    source.removeEventListener('agent-error', onError)
    source.removeEventListener('server-heartbeat', onServerHeartbeat)
    source.close()
  }) as SseSubscription
  unsubscribe.readyState = () => source.readyState
  return unsubscribe
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

export function subscribeSpecsList(pid: string, onChange: () => void): () => void {
  if (!pid) return () => {}
  const source = new EventSource(`${projectBase(pid)}/events/specs`)
  const handler = () => onChange()
  source.addEventListener('list-updated', handler)
  source.addEventListener('error', () => {
    // EventSource auto-reconnects; no-op
  })
  return () => {
    source.removeEventListener('list-updated', handler)
    source.close()
  }
}

export function subscribeProjectsList(onChange: () => void): () => void {
  const source = new EventSource(`/api/events/projects`)
  const handler = () => onChange()
  source.addEventListener('projects-changed', handler)
  source.addEventListener('error', () => {
    // EventSource auto-reconnects; no-op
  })
  return () => {
    source.removeEventListener('projects-changed', handler)
    source.close()
  }
}
