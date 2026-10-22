import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PiAdapter } from '../agent-sdk/pi-adapter.js'
import type { AgentEvent } from '../agent-sdk/types.js'

type PiEvent = Record<string, unknown>

const pi = vi.hoisted(() => ({
  /** Events the fake Pi session replays out of `prompt()`. */
  events: [] as PiEvent[],
  /** `SessionManager.list` payload. */
  listed: [] as Record<string, unknown>[],
  /** `getEntries()` payload for the opened session. */
  entries: [] as Record<string, unknown>[],
  /** Rejection injected into `prompt()`, if any. */
  promptError: null as unknown,
  disposed: 0,
  aborts: 0,
  createAgentSession: vi.fn(),
  managerCreate: vi.fn(),
  managerOpen: vi.fn(),
  managerList: vi.fn(),
  runtimeCreate: vi.fn(),
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: pi.createAgentSession,
  ModelRuntime: { create: pi.runtimeCreate },
  SessionManager: {
    create: pi.managerCreate,
    open: pi.managerOpen,
    list: pi.managerList,
  },
}))

function fakeSession(sessionId: string) {
  const listeners: Array<(event: PiEvent) => void> = []
  return {
    sessionId,
    subscribe(listener: (event: PiEvent) => void) {
      listeners.push(listener)
      return () => {
        listeners.splice(listeners.indexOf(listener), 1)
      }
    },
    async prompt() {
      for (const event of pi.events) for (const listener of listeners) listener(event)
      if (pi.promptError) throw pi.promptError
    },
    async abort() {
      pi.aborts += 1
    },
    dispose() {
      pi.disposed += 1
    },
  }
}

function assistantUsage(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    input: 10,
    output: 5,
    cacheRead: 100,
    cacheWrite: 20,
    reasoning: 2,
    totalTokens: 135,
    cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.003, total: 0.034 },
    ...over,
  }
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

describe('PiAdapter', () => {
  beforeEach(() => {
    pi.events = []
    pi.listed = []
    pi.entries = []
    pi.promptError = null
    pi.disposed = 0
    pi.aborts = 0
    pi.runtimeCreate.mockReset().mockResolvedValue({ kind: 'runtime' })
    pi.managerCreate
      .mockReset()
      .mockImplementation((_cwd: string, _dir: unknown, opts?: { id?: string }) => ({
        __id: opts?.id ?? 'generated-id',
      }))
    pi.managerOpen
      .mockReset()
      .mockImplementation((path: string) => ({ __id: path, getEntries: () => pi.entries }))
    pi.managerList.mockReset().mockImplementation(async () => pi.listed)
    pi.createAgentSession
      .mockReset()
      .mockImplementation(async ({ sessionManager }: { sessionManager: { __id: string } }) => ({
        session: fakeSession(sessionManager.__id),
      }))
  })

  it('maps the turn stream onto normalized events and sums usage', async () => {
    pi.events = [
      { type: 'agent_start' },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
      },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hel' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'lo' } },
      { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { cmd: 'ls' } },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'README.md' }] },
        isError: false,
      },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          model: 'pi-model-1',
          stopReason: 'stop',
          usage: assistantUsage(),
        },
      },
      { type: 'turn_end', message: {}, toolResults: [] },
    ]

    const session = await new PiAdapter('/repo').createSession()
    const events = await collect(session.send('hi'))

    expect(events.map((ev) => ev.type)).toEqual([
      'session-started',
      'text',
      'text',
      'tool-use',
      'tool-result',
      'turn-completed',
    ])
    expect(events).toContainEqual({ type: 'tool-use', name: 'bash', input: { cmd: 'ls' } })
    expect(events).toContainEqual({ type: 'tool-result', text: 'README.md' })
    expect(events.at(-1)).toMatchObject({
      type: 'turn-completed',
      // The raw payload stays in Pi's own shape, as every adapter promises.
      usage: { input: 10, output: 5, cacheRead: 100, cost: { total: 0.034 } },
      metrics: {
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 100,
          cacheCreateTokens: 20,
          reasoningTokens: 2,
          costUsd: 0.034,
        },
        model: 'pi-model-1',
        stopReason: 'stop',
        numTurns: 1,
      },
    })
    // The per-turn session is always released, listeners included.
    expect(pi.disposed).toBe(1)
  })

  it('sums usage across every assistant message of the turn', async () => {
    pi.events = [
      {
        type: 'message_end',
        message: { role: 'assistant', usage: assistantUsage({ input: 1, output: 2 }) },
      },
      {
        type: 'message_end',
        message: { role: 'assistant', usage: assistantUsage({ input: 4, output: 8 }) },
      },
    ]

    const session = await new PiAdapter('/repo').createSession()
    const events = await collect(session.send('hi'))

    expect(events.at(-1)).toMatchObject({
      type: 'turn-completed',
      usage: { input: 5, output: 10, cost: { total: 0.068 } },
      metrics: { usage: { inputTokens: 5, outputTokens: 10, costUsd: 0.068 } },
    })
  })

  it('snapshots the plan phase at the first spec.md write', async () => {
    const specWrite = {
      type: 'tool_execution_start',
      toolCallId: 't1',
      // Pi's builtin write tool is lowercase and names its target `path`.
      toolName: 'write',
      args: { path: '/repo/.yorz/specs/260914.feat.demo/spec.md' },
    }
    pi.events = [
      {
        type: 'message_end',
        message: { role: 'assistant', usage: assistantUsage({ input: 10, output: 1 }) },
      },
      specWrite,
      {
        type: 'message_end',
        message: { role: 'assistant', usage: assistantUsage({ input: 90, output: 9 }) },
      },
      {
        type: 'tool_execution_start',
        toolCallId: 't2',
        toolName: 'edit',
        args: { path: '/repo/src/index.ts' },
      },
    ]

    const session = await new PiAdapter('/repo').createSession()
    const events = await collect(session.send('hi'))
    const last = events.at(-1)
    expect(last?.type).toBe('turn-completed')
    const metrics = (last as unknown as { metrics: Record<string, unknown> }).metrics

    expect(metrics.planPhase).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 1 },
      requests: 1,
    })
    expect(metrics.observedTotal).toMatchObject({
      usage: { inputTokens: 100, outputTokens: 10 },
      requests: 2,
    })
  })

  it('surfaces compaction on the end event only, with its token counts', async () => {
    pi.events = [
      { type: 'compaction_start', reason: 'threshold' },
      {
        type: 'compaction_end',
        reason: 'threshold',
        result: {
          summary: 's',
          firstKeptEntryId: 'e1',
          tokensBefore: 900,
          estimatedTokensAfter: 120,
        },
        aborted: false,
        willRetry: false,
      },
    ]

    const session = await new PiAdapter('/repo').createSession()
    const events = await collect(session.send('hi'))

    const compact = events.filter((ev) => ev.type === 'compact')
    expect(compact).toHaveLength(1)
    expect(compact[0]).toMatchObject({
      type: 'compact',
      metrics: { trigger: 'auto', preTokens: 900, postTokens: 120 },
    })
  })

  it('reports a failed assistant turn as an error event', async () => {
    pi.events = [
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'no model configured',
          usage: assistantUsage(),
        },
      },
    ]

    const session = await new PiAdapter('/repo').createSession()
    const events = await collect(session.send('hi'))

    expect(events).toContainEqual({ type: 'error', message: 'no model configured' })
  })

  it('turns a rejected prompt into an error instead of a completed turn', async () => {
    pi.promptError = new Error('pi auth missing')

    const session = await new PiAdapter('/repo').createSession()
    const events = await collect(session.send('hi'))

    expect(events.map((ev) => ev.type)).toEqual(['session-started', 'error'])
    expect(events.at(-1)).toMatchObject({ type: 'error', message: 'pi auth missing' })
    expect(pi.disposed).toBe(1)
  })

  it('ends the stream silently after abort, emitting no turn-completed', async () => {
    pi.events = [
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial' } },
      { type: 'message_end', message: { role: 'assistant', usage: assistantUsage() } },
    ]

    const session = await new PiAdapter('/repo').createSession()
    const events: AgentEvent[] = []
    for await (const ev of session.send('hi')) {
      events.push(ev)
      if (ev.type === 'text') session.abort()
    }

    expect(events.map((ev) => ev.type)).toEqual(['session-started', 'text'])
    expect(pi.aborts).toBe(1)
  })

  it('falls back to a new session and says so when the id is not on disk', async () => {
    const session = await new PiAdapter('/repo').resumeSession('missing-id')
    const events = await collect(session.send('hi'))

    expect(events[0]).toMatchObject({ type: 'error', message: /missing-id was not found/ })
    expect(events[1]).toMatchObject({ type: 'session-started' })
    expect(pi.managerOpen).not.toHaveBeenCalled()
  })

  it('resumes through the id → path index built from the session list', async () => {
    pi.listed = [
      {
        path: '/pi/sessions/a.jsonl',
        id: 'sid-a',
        cwd: '/repo',
        created: new Date(1),
        modified: new Date(2),
        messageCount: 1,
        firstMessage: 'x',
        allMessagesText: 'x',
      },
    ]

    const session = await new PiAdapter('/repo').resumeSession('sid-a')
    await collect(session.send('hi'))

    expect(pi.managerOpen).toHaveBeenCalledWith('/pi/sessions/a.jsonl', undefined, '/repo')
  })

  it('lists sessions for this cwd only, preferring the user-set name', async () => {
    pi.listed = [
      {
        path: '/pi/a.jsonl',
        id: 'sid-a',
        cwd: '/repo',
        name: 'My session',
        created: new Date(1000),
        modified: new Date(4000),
        messageCount: 2,
        firstMessage: 'hello',
        allMessagesText: 'hello',
      },
      {
        path: '/pi/b.jsonl',
        id: 'sid-b',
        // Sessions written before the header carried a cwd must not be dropped.
        cwd: '',
        created: new Date(2000),
        modified: new Date(3000),
        messageCount: 1,
        firstMessage: '# Fix `the` bug\n\nmore',
        allMessagesText: '',
      },
      {
        path: '/pi/c.jsonl',
        id: 'sid-c',
        cwd: '/other-repo',
        created: new Date(5000),
        modified: new Date(6000),
        messageCount: 1,
        firstMessage: 'nope',
        allMessagesText: '',
      },
    ]

    const sessions = await new PiAdapter('/repo').listSessions()

    expect(sessions).toEqual([
      { id: 'sid-a', title: 'My session', kind: 'pi', createdAt: 1000, updatedAt: 4000 },
      { id: 'sid-b', title: 'Fix the bug more', kind: 'pi', createdAt: 2000, updatedAt: 3000 },
    ])
  })

  it('normalizes history, folding tool results into the preceding assistant message', async () => {
    pi.listed = [
      {
        path: '/pi/a.jsonl',
        id: 'sid-a',
        cwd: '/repo',
        created: new Date(1),
        modified: new Date(2),
        messageCount: 3,
        firstMessage: 'hi',
        allMessagesText: '',
      },
    ]
    pi.entries = [
      { type: 'session_info', id: 'e0', parentId: null, name: 'x' },
      {
        type: 'message',
        id: 'e1',
        parentId: null,
        message: { role: 'user', content: 'hi there', timestamp: 111 },
      },
      {
        type: 'message',
        id: 'e2',
        parentId: 'e1',
        message: {
          role: 'assistant',
          timestamp: 222,
          content: [
            { type: 'thinking', thinking: 'dropped' },
            { type: 'text', text: 'running ls' },
            { type: 'toolCall', id: 't1', name: 'bash', arguments: { cmd: 'ls' } },
          ],
        },
      },
      {
        type: 'message',
        id: 'e3',
        parentId: 'e2',
        message: {
          role: 'toolResult',
          toolCallId: 't1',
          toolName: 'bash',
          timestamp: 333,
          isError: false,
          content: [{ type: 'text', text: 'README.md' }],
        },
      },
    ]

    const messages = await new PiAdapter('/repo').getMessages('sid-a')

    expect(messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'hi there' }], ts: 111 },
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'running ls' },
          { type: 'tool-use', name: 'bash', input: { cmd: 'ls' } },
          { type: 'tool-result', text: 'README.md' },
        ],
        ts: 222,
      },
    ])
  })

  it('declares no usage-status support and shares one model runtime', async () => {
    const adapter = new PiAdapter('/repo')

    expect(adapter.capabilities()).toEqual({
      listSessions: true,
      getMessages: true,
      usageStatus: false,
    })

    await collect((await adapter.createSession()).send('a'))
    await collect((await adapter.createSession()).send('b'))
    expect(pi.runtimeCreate).toHaveBeenCalledTimes(1)
  })

  it('passes explicit model/thinking settings and maps the available catalog', async () => {
    const model = {
      provider: 'openai',
      id: 'gpt-test',
      name: 'GPT Test',
      reasoning: true,
    }
    const getModel = vi.fn(() => model)
    pi.runtimeCreate.mockResolvedValue({
      getModel,
      getAvailable: vi.fn(async () => [model]),
    })
    const adapter = new PiAdapter('/repo')

    await collect(
      (await adapter.createSession({ model: 'openai/gpt-test', reasoningEffort: 'high' })).send(
        'a',
      ),
    )
    expect(getModel).toHaveBeenCalledWith('openai', 'gpt-test')
    expect(pi.createAgentSession.mock.calls[0]?.[0]).toMatchObject({
      model,
      thinkingLevel: 'high',
    })
    await expect(adapter.listModels()).resolves.toMatchObject({
      models: [
        {
          id: 'openai/gpt-test',
          displayName: 'openai · GPT Test',
          reasoningEfforts: expect.arrayContaining([{ id: 'high', displayName: 'high' }]),
        },
      ],
    })
  })

  it('retries runtime creation after a failure instead of caching the rejection', async () => {
    pi.runtimeCreate.mockRejectedValueOnce(new Error('auth.json unreadable'))
    const adapter = new PiAdapter('/repo')

    const first = await collect((await adapter.createSession()).send('a'))
    expect(first).toEqual([{ type: 'error', message: 'auth.json unreadable' }])

    const second = await collect((await adapter.createSession()).send('b'))
    expect(second.at(-1)?.type).toBe('turn-completed')
    expect(pi.runtimeCreate).toHaveBeenCalledTimes(2)
  })
})
