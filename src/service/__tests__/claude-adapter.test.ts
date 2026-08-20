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
    expect(events.at(-1)).toMatchObject({
      type: 'turn-completed',
      usage: { input_tokens: 1, output_tokens: 2 },
      metrics: { usage: { inputTokens: 1, outputTokens: 2 } },
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
    expect(events.at(-1)).toMatchObject({
      type: 'turn-completed',
      usage: { input_tokens: 3, output_tokens: 4 },
      metrics: { usage: { inputTokens: 3, outputTokens: 4 } },
    })
  })

  it('captures cost / model split / turn count and surfaces compaction', async () => {
    sdk.messages = [
      sdkMessage({
        type: 'system',
        subtype: 'compact_boundary',
        session_id: 'sid-1',
        compact_metadata: { trigger: 'auto', pre_tokens: 900, post_tokens: 120, duration_ms: 42 },
      }),
      sdkMessage({
        type: 'result',
        subtype: 'success',
        session_id: 'sid-1',
        usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 30 },
        total_cost_usd: 0.125,
        num_turns: 3,
        stop_reason: 'end_turn',
        duration_ms: 1500,
        duration_api_ms: 1200,
        modelUsage: {
          'claude-opus-4-8': { outputTokens: 2 },
          'claude-haiku-4-5': { outputTokens: 1 },
        },
      }),
    ]

    const session = await new ClaudeAdapter('/tmp').createSession()
    const events = []
    for await (const ev of session.send('hello')) events.push(ev)

    expect(events).toContainEqual({
      type: 'compact',
      metrics: { trigger: 'auto', preTokens: 900, postTokens: 120, durationMs: 42 },
    })
    expect(events.at(-1)).toMatchObject({
      type: 'turn-completed',
      metrics: {
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 30, costUsd: 0.125 },
        numTurns: 3,
        stopReason: 'end_turn',
        model: 'claude-opus-4-8',
        durationMs: 1500,
        apiDurationMs: 1200,
      },
    })
  })

  it('keeps transcript messages whose content is a bare string', async () => {
    sdk.getSessionMessages.mockResolvedValueOnce([
      { type: 'user', message: { role: 'user', content: 'hello' } },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      },
    ] as never)

    const messages = await new ClaudeAdapter('/tmp').getMessages('sid-1')

    expect(messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
    ])
  })
})
