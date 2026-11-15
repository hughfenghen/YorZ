import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * opencode v2 协议适配器的单元测试。
 *
 * 用假的 `spawn` 顶掉本地服务端，用假的 `fetch` 顶掉 HTTP 层，这样协议形状
 * （尤其是 prompt body 的平铺结构、事件名、消息结构）可以被精确断言——这三处
 * 正是官方 SDK 的 `/v2` 与 opencode 2.x 不一致的地方。
 */

const fakeProc = new EventEmitter() as EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => void
}
fakeProc.stdout = new EventEmitter()
fakeProc.stderr = new EventEmitter()
fakeProc.kill = vi.fn()

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(() => fakeProc) }
})

const { OpenCodeV2Adapter, parseQualifiedModel, resolveOpenCodeV2Cli } =
  await import('../agent-sdk/opencode-v2-adapter.js')

const BASE = 'http://127.0.0.1:9999'

type FetchCall = { url: string; method: string; body?: unknown }

/** 可手动推事件的 SSE 流。 */
function makeEventStream() {
  const encoder = new TextEncoder()
  const pushed: Record<string, unknown>[] = []
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      c.enqueue(encoder.encode(': heartbeat\n\n'))
    },
  })
  return {
    stream,
    pushed,
    push(event: Record<string, unknown>) {
      pushed.push(event)
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    },
  }
}

/** 记录所有请求，并按 pathname 返回预设响应。 */
function installFetch(
  routes: Record<string, unknown>,
  events: ReturnType<typeof makeEventStream>,
): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    if (url.endsWith('/api/event')) {
      return new Response(events.stream, {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    const key = Object.keys(routes).find((route) => url.includes(route))
    if (!key) {
      return new Response(JSON.stringify({ _tag: 'NotFound' }), { status: 404 })
    }
    return new Response(JSON.stringify(routes[key]), {
      headers: { 'content-type': 'application/json' },
    })
  })
  return calls
}

/** 等适配器真正订阅上事件流（顺序在 prompt POST 之前完成）。 */
async function waitForPromptLanding(calls: FetchCall[]): Promise<void> {
  await vi.waitFor(() => {
    expect(calls.some((c) => c.url.includes('/prompt'))).toBe(true)
  })
}

describe('OpenCodeV2Adapter', () => {
  beforeEach(() => {
    fakeProc.stdout.removeAllListeners()
    fakeProc.stderr.removeAllListeners()
    fakeProc.removeAllListeners()
    // 启动器等 stdout 上的 `server listening on <url>`。
    setTimeout(() => {
      fakeProc.stdout.emit('data', Buffer.from(`server listening on ${BASE}\n`))
    }, 0)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('splits provider/model ids without truncating model slashes', () => {
    expect(parseQualifiedModel('openrouter/anthropic/claude')).toEqual({
      providerID: 'openrouter',
      modelID: 'anthropic/claude',
    })
    expect(parseQualifiedModel('invalid')).toBeUndefined()
    expect(parseQualifiedModel(undefined)).toBeUndefined()
  })

  it('creates a session with title, model and location', async () => {
    const calls = installFetch({ '/api/session': { data: { id: 'ses_1' } } }, makeEventStream())
    const adapter = new OpenCodeV2Adapter('/repo', { cli: '/fake/opencode' })
    await adapter.createSession({
      title: '标题',
      model: 'openai/gpt-test',
      reasoningEffort: 'high',
    })

    const call = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/session'))
    expect(call?.body).toEqual({
      title: '标题',
      model: { id: 'gpt-test', providerID: 'openai', variant: 'high' },
      location: { directory: '/repo' },
    })
    await adapter.dispose()
  })

  it('posts a FLAT prompt body, streams text deltas, and ends only on execution', async () => {
    const events = makeEventStream()
    const calls = installFetch({ '/api/session/ses_1/prompt': { data: { id: 'msg_1' } } }, events)
    const adapter = new OpenCodeV2Adapter('/repo', { cli: '/fake/opencode' })
    const session = await adapter.resumeSession('ses_1')

    const collected: string[] = []
    let completed = false
    const turn = (async () => {
      for await (const event of session.send('hello')) {
        collected.push(event.type === 'text' ? `text:${event.delta}` : event.type)
        if (event.type === 'turn-completed') {
          completed = true
          collected.push(`usage:${JSON.stringify(event.metrics?.usage)}`)
        }
      }
    })()

    // 等 prompt 落到服务端。
    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.includes('/prompt'))).toBe(true)
    })
    // v2 的 body 是 `{ text }`；写成 `{ prompt: { text } }` 服务端会 400。
    expect(calls.find((c) => c.url.includes('/prompt'))?.body).toEqual({ text: 'hello' })

    events.push({
      id: 'evt_1',
      type: 'session.text.delta',
      data: { sessionID: 'ses_1', assistantMessageID: 'msg_2', ordinal: 0, delta: 'PONG' },
    })
    // 一个 step 结束不等于一轮结束：带工具的 turn 会接着跑下一个 step。
    events.push({
      id: 'evt_2',
      type: 'session.step.ended',
      data: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_2',
        finish: 'stop',
        tokens: { input: 10, output: 2, cache: { read: 5, write: 0 } },
      },
    })
    await vi.waitFor(() => expect(collected).toContain('text:PONG'))
    expect(completed).toBe(false)

    events.push({ id: 'evt_3', type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })

    await turn
    expect(collected[0]).toBe('text:PONG')
    expect(collected).toContain('turn-completed')
    expect(collected.join(' ')).toContain('"inputTokens":10')
    await adapter.dispose()
  })

  it('keeps the turn open across steps and sums per-step usage', async () => {
    const events = makeEventStream()
    const calls = installFetch({ '/api/session/ses_1/prompt': { data: { id: 'msg_1' } } }, events)
    const adapter = new OpenCodeV2Adapter('/repo', { cli: '/fake/opencode' })
    const session = await adapter.resumeSession('ses_1')

    const seen: string[] = []
    let metrics: { usage?: Record<string, unknown> } | undefined
    const turn = (async () => {
      for await (const event of session.send('run two tools')) {
        seen.push(event.type)
        if (event.type === 'turn-completed') metrics = event.metrics as typeof metrics
      }
    })()

    await waitForPromptLanding(calls)
    events.push({
      id: 'e1',
      type: 'session.step.ended',
      data: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_2',
        finish: 'tool-calls',
        tokens: { input: 100, output: 10, cache: { read: 40, write: 0 } },
      },
    })
    events.push({
      id: 'e2',
      type: 'session.step.ended',
      data: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_3',
        finish: 'stop',
        tokens: { input: 50, output: 5, reasoning: 3, cache: { read: 20, write: 1 } },
      },
    })
    // 会话累计用量不应被当成本轮用量。
    events.push({
      id: 'e3',
      type: 'session.usage.updated',
      data: { sessionID: 'ses_1', tokens: { input: 9999, output: 9999 } },
    })
    await waitForPromptLanding(calls)
    expect(seen).not.toContain('turn-completed')

    events.push({ id: 'e4', type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })

    await turn
    expect(metrics?.usage).toMatchObject({ inputTokens: 150, outputTokens: 15 })
  })

  it('backfills text from text.ended without duplicating streamed deltas', async () => {
    const events = makeEventStream()
    const calls = installFetch({ '/api/session/ses_1/prompt': { data: { id: 'msg_1' } } }, events)
    const adapter = new OpenCodeV2Adapter('/repo', { cli: '/fake/opencode' })
    const session = await adapter.resumeSession('ses_1')

    const deltas: string[] = []
    const turn = (async () => {
      for await (const event of session.send('hi')) {
        if (event.type === 'text') deltas.push(event.delta)
      }
    })()

    await waitForPromptLanding(calls)
    // 前半段被流式推过：text.ended 只该补后半段。
    events.push({
      id: 'e1',
      type: 'session.text.delta',
      data: { sessionID: 'ses_1', assistantMessageID: 'msg_2', ordinal: 0, delta: 'HEL' },
    })
    events.push({
      id: 'e2',
      type: 'session.text.ended',
      data: { sessionID: 'ses_1', assistantMessageID: 'msg_2', ordinal: 0, text: 'HELLO' },
    })
    // 完全没有 delta 的回复（provider 不流式）：整段正文由 text.ended 补出。
    events.push({
      id: 'e3',
      type: 'session.text.ended',
      data: { sessionID: 'ses_1', assistantMessageID: 'msg_3', ordinal: 0, text: 'SECOND' },
    })
    events.push({ id: 'e4', type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })

    await turn
    expect(deltas.join('')).toBe('HELLOSECOND')
  })

  it('reports tool name, input and result from the v2 tool event chain', async () => {
    const events = makeEventStream()
    const calls = installFetch({ '/api/session/ses_1/prompt': { data: { id: 'msg_1' } } }, events)
    const adapter = new OpenCodeV2Adapter('/repo', { cli: '/fake/opencode' })
    const session = await adapter.resumeSession('ses_1')

    const seen: Array<Record<string, unknown>> = []
    const turn = (async () => {
      for await (const event of session.send('ls')) {
        if (event.type === 'tool-use' || event.type === 'tool-result') seen.push(event)
      }
    })()

    await waitForPromptLanding(calls)
    // 真实顺序：input.started（有 name）→ input.ended（无 name）→ called（有 input）→ success（content 里才有正文）
    events.push({
      id: 'e1',
      type: 'session.tool.input.started',
      data: { sessionID: 'ses_1', assistantMessageID: 'msg_2', id: 'call_1', name: 'bash' },
    })
    events.push({
      id: 'e2',
      type: 'session.tool.input.ended',
      data: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_2',
        id: 'call_1',
        text: '{"command":"ls"}',
      },
    })
    events.push({
      id: 'e3',
      type: 'session.tool.called',
      data: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_2',
        id: 'call_1',
        input: { command: 'ls' },
      },
    })
    events.push({
      id: 'e4',
      type: 'session.tool.success',
      data: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_2',
        id: 'call_1',
        content: [{ type: 'text', text: 'a.txt\nb.txt' }],
      },
    })
    events.push({ id: 'e5', type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })

    await turn
    expect(seen).toEqual([
      { type: 'tool-use', name: 'bash', input: { command: 'ls' } },
      { type: 'tool-result', text: 'a.txt\nb.txt' },
    ])
  })

  it('surfaces execution.failed error.message as a string', async () => {
    const events = makeEventStream()
    const calls = installFetch({ '/api/session/ses_1/prompt': { data: { id: 'msg_1' } } }, events)
    const adapter = new OpenCodeV2Adapter('/repo', { cli: '/fake/opencode' })
    const session = await adapter.resumeSession('ses_1')

    const errors: string[] = []
    const turn = (async () => {
      for await (const event of session.send('boom')) {
        if (event.type === 'error') errors.push(event.message)
      }
    })()

    await waitForPromptLanding(calls)
    events.push({
      id: 'e1',
      type: 'session.step.failed',
      data: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_2',
        error: { type: 'ProviderError', message: 'rate limited' },
      },
    })
    events.push({
      id: 'e2',
      type: 'session.execution.failed',
      data: { sessionID: 'ses_1', error: { type: 'ProviderError', message: 'rate limited' } },
    })

    await turn
    expect(errors).toEqual(['rate limited'])
  })

  it('maps /api/model into the model catalog', async () => {
    installFetch(
      {
        '/api/model': {
          data: [
            {
              id: 'gpt-test',
              providerID: 'openai',
              name: 'GPT Test',
              variants: [{ id: 'low' }, { id: 'high' }],
              enabled: true,
              status: 'active',
            },
            { id: 'old', providerID: 'openai', name: 'Old', enabled: false },
            { id: 'gone', providerID: 'openai', name: 'Gone', status: 'deprecated' },
          ],
        },
      },
      makeEventStream(),
    )
    const adapter = new OpenCodeV2Adapter('/repo', { cli: '/fake/opencode' })
    const catalog = await adapter.listModels()
    expect(catalog.models).toEqual([
      {
        id: 'openai/gpt-test',
        displayName: 'openai · GPT Test',
        reasoningEfforts: [
          { id: 'low', displayName: 'low' },
          { id: 'high', displayName: 'high' },
        ],
      },
    ])
    await adapter.dispose()
  })

  it('normalizes v2 messages into role/parts, oldest first', async () => {
    installFetch(
      {
        '/api/session/ses_1/message': {
          // 真实 2.x 服务端返回 newest-first：idle 在最前，用户提问在最后。
          data: [
            { id: 'm3', type: 'idle', outcome: 'succeeded' },
            {
              id: 'm2',
              type: 'assistant',
              time: { created: 20 },
              content: [
                { type: 'text', text: '答案' },
                {
                  type: 'tool',
                  id: 't1',
                  name: 'write',
                  state: { status: 'completed', input: { path: 'a' } },
                },
              ],
            },
            { id: 'm1', type: 'user', text: '问题', time: { created: 10 } },
          ],
        },
      },
      makeEventStream(),
    )
    const adapter = new OpenCodeV2Adapter('/repo', { cli: '/fake/opencode' })
    const messages = await adapter.getMessages('ses_1')
    expect(messages).toEqual([
      { role: 'user', parts: [{ type: 'text', text: '问题' }], ts: 10 },
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: '答案' },
          { type: 'tool-use', name: 'write', input: { path: 'a' } },
        ],
        ts: 20,
      },
    ])
    await adapter.dispose()
  })

  it('trusts an explicitly configured CLI without probing it', async () => {
    const probe = vi.fn(async () => 'v2' as const)
    // 用一个确实存在的路径（node 自身），验证「显式指定」这条分支不依赖存在性之外的逻辑。
    const resolved = await resolveOpenCodeV2Cli(
      { OPENCODE_V2_CLI: process.execPath },
      'linux',
      probe,
    )
    expect(resolved).toBe(process.execPath)
    // 显式指定时不做版本探测。
    expect(probe).not.toHaveBeenCalled()
  })

  it('lists sessions with v2 field names', async () => {
    installFetch(
      {
        '/api/session?': {
          data: [
            {
              id: 'ses_1',
              title: '标题',
              time: { created: 1, updated: 2 },
              location: { directory: '/repo' },
            },
          ],
        },
      },
      makeEventStream(),
    )
    const adapter = new OpenCodeV2Adapter('/repo', { cli: '/fake/opencode' })
    const sessions = await adapter.listSessions()
    expect(sessions).toEqual([
      { id: 'ses_1', title: '标题', kind: 'opencode-v2', createdAt: 1, updatedAt: 2 },
    ])
    await adapter.dispose()
  })
})
