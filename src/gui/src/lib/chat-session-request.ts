import { createSignal } from 'solid-js'
import type { AgentKind } from '@shared/api/index.js'

// Cross-component request for the Chat panel to switch to a given session id.
// Pages (spec detail / review / new) call requestChatSession() to make the Chat
// panel select the spec's dedicated session and render its system rounds.
const [requestedChatSessionId, setRequestedChatSessionId] = createSignal('')
export { requestedChatSessionId }

/**
 * Optional optimistic round for the requested session: a system-driven round
 * (append / run / git-ops) dispatches its user turn server-side, so it never
 * streams over SSE and would otherwise be invisible until the round's transcript
 * is read back. When present, the Chat panel paints `userText` (+ a divider) the
 * instant it switches, exactly like a normal send shows the composer's text.
 */
export interface OptimisticRound {
  sessionId: string
  userText: string
  kind: AgentKind
}
const [requestedOptimisticRound, setRequestedOptimisticRound] = createSignal<OptimisticRound | null>(
  null,
)
export { requestedOptimisticRound }

export function requestChatSession(
  sessionId: string,
  optimistic?: { userText: string; kind: AgentKind },
): void {
  if (!sessionId) return
  setRequestedChatSessionId(sessionId)
  setRequestedOptimisticRound(
    optimistic && optimistic.userText ? { sessionId, ...optimistic } : null,
  )
}

export function clearRequestedChatSession(): void {
  setRequestedChatSessionId('')
  setRequestedOptimisticRound(null)
}
