import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRequestedChatSession,
  requestedChatSessionId,
  requestChatSession,
} from '../chat-session-request.js'

describe('chat session switch requests', () => {
  beforeEach(() => {
    clearRequestedChatSession()
  })

  it('can be cleared after ChatPanel consumes a switch request', () => {
    requestChatSession('sid-a')
    expect(requestedChatSessionId()).toBe('sid-a')

    clearRequestedChatSession()
    expect(requestedChatSessionId()).toBe('')

    requestChatSession('sid-a')
    expect(requestedChatSessionId()).toBe('sid-a')
  })
})
