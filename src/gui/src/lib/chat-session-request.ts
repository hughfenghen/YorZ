import { createSignal } from 'solid-js'

// Cross-component request for the Chat panel to switch to a given session id.
// Pages (spec detail / review / new) call requestChatSession() to make the Chat
// panel select the spec's dedicated session and render its system rounds.
const [requestedChatSessionId, setRequestedChatSessionId] = createSignal('')
export { requestedChatSessionId }

export function requestChatSession(sessionId: string): void {
  if (sessionId) setRequestedChatSessionId(sessionId)
}

export function clearRequestedChatSession(): void {
  setRequestedChatSessionId('')
}
