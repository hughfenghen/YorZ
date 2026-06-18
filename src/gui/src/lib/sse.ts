export type AgentMode = 'skill-run' | 'explain'

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

export interface SpecSubscribeHandlers {
  onUpdated?: () => void
  onAgentStdout?: (e: AgentStdoutEvent) => void
  onAgentExit?: (e: AgentExitEvent) => void
  onAgentError?: (e: AgentErrorEvent) => void
}

export function subscribeSpec(id: string, handlers: SpecSubscribeHandlers): () => void {
  const source = new EventSource(`/api/specs/${encodeURIComponent(id)}/events`)
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

  source.addEventListener('updated', onUpdated)
  source.addEventListener('agent-stdout', onAgentStdout)
  source.addEventListener('agent-exit', onAgentExit)
  source.addEventListener('agent-error', onAgentError)
  source.addEventListener('error', () => {
    // EventSource auto-reconnects; no-op
  })

  return () => {
    source.removeEventListener('updated', onUpdated)
    source.removeEventListener('agent-stdout', onAgentStdout)
    source.removeEventListener('agent-exit', onAgentExit)
    source.removeEventListener('agent-error', onAgentError)
    source.close()
  }
}

export interface RunSubscribeHandlers {
  onAgentStdout?: (e: AgentStdoutEvent) => void
  onAgentExit?: (e: AgentExitEvent) => void
  onAgentError?: (e: AgentErrorEvent) => void
}

export function subscribeRun(runId: string, handlers: RunSubscribeHandlers): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`)
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
  source.addEventListener('agent-stdout', onStdout)
  source.addEventListener('agent-exit', onExit)
  source.addEventListener('agent-error', onError)
  source.addEventListener('error', () => {
    // EventSource auto-reconnects; no-op
  })
  return () => {
    source.removeEventListener('agent-stdout', onStdout)
    source.removeEventListener('agent-exit', onExit)
    source.removeEventListener('agent-error', onError)
    source.close()
  }
}

export interface ActiveRunInfo {
  runId: string
  mode: AgentMode
  specId: string
  startedAt: number
}

export async function fetchActiveRuns(): Promise<ActiveRunInfo[]> {
  const res = await fetch('/api/runs')
  if (!res.ok) return []
  try {
    return (await res.json()) as ActiveRunInfo[]
  } catch {
    return []
  }
}

export async function cancelRun(runId: string): Promise<void> {
  try {
    await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
  } catch {
    // network errors / 404 (run already ended) are non-fatal
  }
}

export function subscribeSpecsList(onChange: () => void): () => void {
  const source = new EventSource('/api/events/specs')
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
