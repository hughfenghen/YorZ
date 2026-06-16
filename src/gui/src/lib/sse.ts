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
