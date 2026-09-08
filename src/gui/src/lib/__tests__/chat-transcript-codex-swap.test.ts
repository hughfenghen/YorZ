// @vitest-environment jsdom
/**
 * codex 在一轮中途把 session id 从「前端建号拿到的 id」换成「codex 真实 thread
 * id」（`session-started`）。这条路径是 claude 没有的，也是移动端草稿首发后
 * 「加载中 → 这个会话还没有消息 → 正确内容」三段闪烁的唯一分叉点。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemo, createRoot, createSignal } from 'solid-js'
import type { SessionEvent } from '@shared/api/sse.js'

const createSession = vi.fn(async () => ({ sessionId: 'sid-A', kind: 'codex' as const }))
const sendSessionMessage = vi.fn(async () => ({ ok: true }))
const getSessionMessages = vi.fn(async () => [] as unknown[])

vi.mock('@shared/api/index.js', () => ({
  api: {
    createSession: (...a: unknown[]) => createSession(...(a as [])),
    sendSessionMessage: (...a: unknown[]) => sendSessionMessage(...(a as [])),
    getSessionMessages: (...a: unknown[]) => getSessionMessages(...(a as [])),
    getSpecMessages: async () => [],
  },
}))

/** sid → 该 sid 的 SSE 订阅回调，测试用来手工投递事件。 */
const subs = new Map<string, (ev: SessionEvent) => void>()
vi.mock('@shared/api/sse.js', () => ({
  subscribeSession: (
    _pid: string,
    sid: string,
    h: { onReady?: () => void; onEvent: (ev: SessionEvent) => void },
  ) => {
    subs.set(sid, h.onEvent)
    h.onReady?.()
    return () => subs.delete(sid)
  },
}))

const { createChatTranscript } = await import('@shared/lib/chat-transcript.js')

interface Row {
  id: string
  title: string
  running?: boolean
  specId?: string
}

/**
 * 移动端 ChatDetail 的接线（只保留与本 bug 相关的部分）：sid 由本地覆盖信号
 * 领先于路由，会话列表是标题 / specId / 运行态的来源，`onSessionsChanged`
 * 触发列表重取（`listPending` 立刻为 true）。
 */
function mountMobileHost() {
  return createRoot((dispose) => {
    const [sidOverride, setSidOverride] = createSignal<string | null>(null)
    const sid = () => sidOverride() ?? ''
    const [list, setList] = createSignal<Row[]>([])
    const [listPending, setListPending] = createSignal(false)
    const [running, setRunning] = createSignal(false)
    const current = createMemo(() => list().find((r) => r.id === sid()))

    let refetches = 0
    const tx = createChatTranscript({
      projectId: () => 'p1',
      sessionId: sid,
      specId: () => current()?.specId,
      running,
      listPending,
      known: () => Boolean(current()),
      onSessionIdChange: setSidOverride,
      onSessionsChanged: () => {
        refetches += 1
        setListPending(true)
      },
      onRunningChange: (changed, value) => {
        if (changed === sid()) setRunning(value)
      },
      errorLabel: (m) => `[Error] ${m}`,
    })

    /** 列表请求落地：写回列表并落下 pending。 */
    const settleList = (rows: Row[]) => {
      setList(rows)
      setListPending(false)
    }

    const snapshot = () => ({
      loading: tx.historyLoading(),
      texts: tx.blocks().map((b) => {
        if (b.kind === 'user') return `user:${b.text}`
        if (b.kind === 'assistant') {
          const text = b.segments
            .map((s) => (s.kind === 'text' ? s.text : `<${s.tools.length} tools>`))
            .join('')
          return `assistant:${text}`
        }
        return b.kind
      }),
    })

    return { tx, sid, settleList, snapshot, dispose, refetchCount: () => refetches }
  })
}

beforeEach(() => {
  subs.clear()
  createSession.mockClear()
  sendSessionMessage.mockClear()
  getSessionMessages.mockClear()
})

describe('createChatTranscript · codex 中途换 session id', () => {
  it('换 id 不得清屏、不得把已有内容切回加载中', async () => {
    const host = mountMobileHost()
    try {
      // 1) 草稿首发：建号拿到 sid-A，乐观用户气泡立刻上屏。
      await host.tx.send('你好')
      // 列表在 POST 之后被重取，这里让它带着 sid-A 落地（标题就绪）。
      host.settleList([{ id: 'sid-A', title: '你好' }])

      const afterSend = host.snapshot()
      expect(afterSend).toEqual({ loading: false, texts: ['user:你好'] })

      // 2) codex 报出真实 thread id：sid-A → sid-B。
      const trace: ReturnType<typeof host.snapshot>[] = []
      const onEventA = subs.get('sid-A')
      expect(onEventA).toBeTypeOf('function')
      onEventA?.({ type: 'session-started', sessionId: 'sid-B' } as SessionEvent)
      trace.push(host.snapshot())

      // 换 id 只是记账，屏上那条用户消息一帧都不该消失，也不该退回加载态。
      expect(trace[0]).toEqual({ loading: false, texts: ['user:你好'] })

      // 3) 换 id 期间发出的读取（若有）落地后同样不得清屏。
      await new Promise((r) => setTimeout(r, 0))
      expect(host.snapshot()).toEqual({ loading: false, texts: ['user:你好'] })

      // 4) 新 id 的列表落地后，仍是这条消息。
      host.settleList([{ id: 'sid-B', title: '你好', running: true }])
      await new Promise((r) => setTimeout(r, 0))
      expect(host.snapshot()).toEqual({ loading: false, texts: ['user:你好'] })

      // 5) 新 id 上的流式输出接着落在同一屏内容之后。
      subs.get('sid-B')?.({ type: 'text', delta: '嗨' } as SessionEvent)
      await new Promise((r) => setTimeout(r, 120))
      expect(host.snapshot().texts).toEqual(['user:你好', 'assistant:嗨'])
    } finally {
      host.dispose()
    }
  })

  it('换 id 后运行态跟着新 id 走', async () => {
    const host = mountMobileHost()
    try {
      await host.tx.send('你好')
      host.settleList([{ id: 'sid-A', title: '你好' }])
      subs.get('sid-A')?.({ type: 'session-started', sessionId: 'sid-B' } as SessionEvent)
      expect(host.sid()).toBe('sid-B')
      expect(host.tx.running()).toBe(true)
    } finally {
      host.dispose()
    }
  })
})
