import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeAdapter } from '../agent-sdk/claude-adapter.js'

const sdk = vi.hoisted(() => ({
  messages: [] as SDKMessage[],
  query: vi.fn(),
  listSessions: vi.fn(async () => []),
  getSessionMessages: vi.fn(async () => []),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdk.query,
  listSessions: sdk.listSessions,
  getSessionMessages: sdk.getSessionMessages,
}))

async function* streamMessages(): AsyncIterable<SDKMessage> {
  for (const msg of sdk.messages) yield msg
}

function sdkMessage(value: unknown): SDKMessage {
  return value as SDKMessage
}

describe('ClaudeAdapter', () => {
  beforeEach(() => {
    sdk.messages = []
    sdk.query.mockReset()
    sdk.query.mockReturnValue(streamMessages())
  })

  it('waits for session idle before emitting turn-completed', async () => {
    sdk.messages = [
      sdkMessage({
        type: 'assistant',
        session_id: 'sid-1',
        message: { content: [{ type: 'text', text: 'before result' }] },
      }),
      sdkMessage({
        type: 'result',
        subtype: 'success',
        session_id: 'sid-1',
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
      sdkMessage({
        type: 'assistant',
        session_id: 'sid-1',
        message: { content: [{ type: 'text', text: 'after result' }] },
      }),
      sdkMessage({
        type: 'system',
        subtype: 'session_state_changed',
        state: 'idle',
        session_id: 'sid-1',
      }),
    ]

    const session = await new ClaudeAdapter('/tmp').createSession()
    const events = []
    for await (const ev of session.send('hello')) events.push(ev)

    expect(events.map((ev) => ev.type)).toEqual([
      'session-started',
      'text',
      'text',
      'turn-completed',
    ])
    expect(events).toContainEqual({ type: 'text', delta: 'after result' })
    expect(events.at(-1)).toEqual({
      type: 'turn-completed',
      usage: { input_tokens: 1, output_tokens: 2 },
    })
  })

  it('falls back to stream end when idle is not emitted', async () => {
    sdk.messages = [
      sdkMessage({
        type: 'assistant',
        session_id: 'sid-1',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
      sdkMessage({
        type: 'result',
        subtype: 'success',
        session_id: 'sid-1',
        usage: { input_tokens: 3, output_tokens: 4 },
      }),
    ]

    const session = await new ClaudeAdapter('/tmp').createSession()
    const events = []
    for await (const ev of session.send('hello')) events.push(ev)

    expect(events.map((ev) => ev.type)).toEqual(['session-started', 'text', 'turn-completed'])
    expect(events.at(-1)).toEqual({
      type: 'turn-completed',
      usage: { input_tokens: 3, output_tokens: 4 },
    })
  })
})
