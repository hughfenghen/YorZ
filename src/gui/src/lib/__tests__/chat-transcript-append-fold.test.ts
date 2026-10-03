// @vitest-environment jsdom
/**
 * 回归：spec 详情页「追加任务」后，新一轮的隔离线（divider）与用户气泡
 * （/yorz-spec …）不上屏，必须整页刷新才正常。
 *
 * 根因：divider 与 append 的用户 turn 只存在于 transcript（SSE 不发这两类事件，
 * 也不像普通 send 那样乐观 push）。切到新一轮时它的 transcript 还没落盘，会被
 * `specMessagesToParts` 跳过，实时 delta 于是合并进上一轮的气泡；运行期间历史读
 * 被 `planHistoryLoad` 的 `keep` 门控挡住，唯一的自动补齐时机是本轮 running
 * true→false 触发的那次 load——一旦这个边沿没被干净观测到，就只能手动刷新。
 *
 * 修复：在会话自身的 `turn-completed` 上主动补读（不依赖列表的 running 边沿），
 * 并用「已折叠 session 集合」防止一次尚未落盘的空读覆盖已流式的实时内容。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEffect, createMemo, createRoot, createSignal } from 'solid-js'
import type { SessionEvent } from '@shared/api/sse.js'

type SpecEntry = {
  sessionId: string
  kind: 'claude'
  createdAt: number
  messages: Array<{ role: 'user' | 'assistant'; parts: Array<{ type: 'text'; text: string }>; ts: number }>
}

let specMessages: SpecEntry[] = []
const getSpecMessages = vi.fn(async () => specMessages)
const getSessionMessages = vi.fn(async () => [] as unknown[])

vi.mock('@shared/api/index.js', () => ({
  api: {
    createSession: async () => ({ sessionId: 'x', kind: 'claude' as const }),
    sendSessionMessage: async () => ({ ok: true }),
    getSessionMessages: (...a: unknown[]) => getSessionMessages(...(a as [])),
    getSpecMessages: (...a: unknown[]) => getSpecMessages(...(a as [])),
  },
}))

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
  createdAt: number
  updatedAt: number
}

const assistant = (text: string) => ({ role: 'assistant' as const, parts: [{ type: 'text' as const, text }], ts: 1 })
const user = (text: string) => ({ role: 'user' as const, parts: [{ type: 'text' as const, text }], ts: 1 })

/** 桌面 ChatPanel 的接线（只保留与本 bug 相关的部分）。 */
function mountDesktopHost() {
  return createRoot((dispose) => {
    const [activeSid, setActiveSid] = createSignal('')
    const [list, setList] = createSignal<Row[]>([])
    const [listLoading, setListLoading] = createSignal(false)
    const [runningSids, setRunningSids] = createSignal<Record<string, boolean>>({})

    const isRunning = (sid: string) => runningSids()[sid] === true
    const group = createMemo(() => list().find((r) => r.id === activeSid()))
    const activeSpecId = createMemo(() => group()?.specId)
    const known = createMemo(() => Boolean(group()))
    const listPending = createMemo(() => !known() && listLoading())
    const activeRunning = createMemo(() => {
      const sid = activeSid()
      return sid ? isRunning(sid) : false
    })

    // 镜像 ChatPanel：每次列表响应重建 runningSids。
    createEffect(() => {
      const l = list()
      const sid = activeSid()
      setRunningSids((prev) => {
        const next: Record<string, boolean> = {}
        for (const s of l) next[s.id] = Boolean(s.running)
        if (sid && !(sid in next) && prev[sid] === true) next[sid] = true
        return next
      })
    })

    const tx = createChatTranscript({
      projectId: () => 'p1',
      sessionId: activeSid,
      specId: activeSpecId,
      running: activeRunning,
      listPending,
      known,
      onSessionIdChange: setActiveSid,
      onRunningChange: (sid, v) => setRunningSids((prev) => ({ ...prev, [sid]: v })),
      onSessionsChanged: () => {},
      errorLabel: (m) => `[Error] ${m}`,
    })

    const selectSession = (sid: string) => {
      if (!sid || sid === activeSid()) return
      setListLoading(true)
      setActiveSid(sid)
    }
    const settleList = (rows: Row[]) => {
      setList(rows)
      setListLoading(false)
    }

    const snapshot = () =>
      tx.blocks().map((b) => {
        if (b.kind === 'user') return `user:${b.text}`
        if (b.kind === 'divider') return `divider:${b.agentKind}`
        if (b.kind === 'assistant')
          return `assistant:${b.segments.map((s) => (s.kind === 'text' ? s.text : `<tools>`)).join('')}`
        return b.kind
      })

    return { tx, selectSession, settleList, snapshot, dispose }
  })
}

const tick = (ms = 160) => new Promise((r) => setTimeout(r, ms))
const S = 'spec-1'
const roundA: SpecEntry = { sessionId: 'roundA', kind: 'claude', createdAt: 1, messages: [assistant('ROUND-A-OUT')] }

/** 起手：spec 已有一轮 roundA，面板停在它上面。 */
async function openWithRoundA(host: ReturnType<typeof mountDesktopHost>) {
  specMessages = [roundA]
  host.settleList([{ id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 }])
  host.selectSession('roundA')
  host.settleList([{ id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 }])
  await tick()
}

beforeEach(() => {
  subs.clear()
  getSpecMessages.mockClear()
  getSessionMessages.mockClear()
  specMessages = []
})

describe('createChatTranscript · 追加任务后折入新一轮', () => {
  it('本轮结束即补入 divider 与 /yorz-spec 用户气泡，无需刷新', async () => {
    const host = mountDesktopHost()
    try {
      await openWithRoundA(host)
      expect(host.snapshot()).toEqual(['assistant:ROUND-A-OUT'])

      // 追加任务：后端建 roundB 起 run，前端切过去；此刻 roundB transcript 尚空。
      specMessages = [roundA, { sessionId: 'roundB', kind: 'claude', createdAt: 10, messages: [] }]
      host.selectSession('roundB')
      host.settleList([
        { id: 'roundB', title: 'B', specId: S, running: true, createdAt: 10, updatedAt: 10 },
        { id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 },
      ])
      await tick()

      // 运行期间实时输出（会合并进上一轮气泡——运行期不补读，符合既有 keep 门控）。
      subs.get('roundB')?.({ type: 'text', delta: 'ROUND-B-OUT' } as SessionEvent)
      await tick()

      // 本轮结束：用户 prompt + assistant 都已落盘。
      specMessages = [
        roundA,
        {
          sessionId: 'roundB',
          kind: 'claude',
          createdAt: 10,
          messages: [user('/yorz-spec refct'), assistant('ROUND-B-OUT')],
        },
      ]
      subs.get('roundB')?.({ type: 'turn-completed' } as SessionEvent)
      host.settleList([
        { id: 'roundB', title: 'B', specId: S, running: false, createdAt: 10, updatedAt: 11 },
        { id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 },
      ])
      await tick(220)

      expect(host.snapshot()).toEqual([
        'assistant:ROUND-A-OUT',
        'divider:claude',
        'user:/yorz-spec refct',
        'assistant:ROUND-B-OUT',
      ])
    } finally {
      host.dispose()
    }
  })

  it('列表从未上报 running 时也能折入（补读不依赖 running 边沿）', async () => {
    const host = mountDesktopHost()
    try {
      await openWithRoundA(host)

      specMessages = [roundA, { sessionId: 'roundB', kind: 'claude', createdAt: 10, messages: [] }]
      host.selectSession('roundB')
      // 列表落地时 running 一直是 false（边沿丢失）。
      host.settleList([
        { id: 'roundB', title: 'B', specId: S, running: false, createdAt: 10, updatedAt: 10 },
        { id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 },
      ])
      await tick()
      subs.get('roundB')?.({ type: 'text', delta: 'ROUND-B-OUT' } as SessionEvent)
      await tick()

      specMessages = [
        roundA,
        {
          sessionId: 'roundB',
          kind: 'claude',
          createdAt: 10,
          messages: [user('/yorz-spec refct'), assistant('ROUND-B-OUT')],
        },
      ]
      subs.get('roundB')?.({ type: 'turn-completed' } as SessionEvent)
      host.settleList([
        { id: 'roundB', title: 'B', specId: S, running: false, createdAt: 10, updatedAt: 11 },
        { id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 },
      ])
      await tick(220)

      expect(host.snapshot()).toContain('divider:claude')
      expect(host.snapshot()).toContain('user:/yorz-spec refct')
    } finally {
      host.dispose()
    }
  })

  it('结束补读若读到尚未落盘的空 transcript，不得覆盖已流式的实时内容', async () => {
    const host = mountDesktopHost()
    try {
      await openWithRoundA(host)

      specMessages = [roundA, { sessionId: 'roundB', kind: 'claude', createdAt: 10, messages: [] }]
      host.selectSession('roundB')
      host.settleList([
        { id: 'roundB', title: 'B', specId: S, running: true, createdAt: 10, updatedAt: 10 },
        { id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 },
      ])
      await tick()
      subs.get('roundB')?.({ type: 'text', delta: 'ROUND-B-OUT' } as SessionEvent)
      await tick()

      // turn-completed 与 running=false 落地，但 getSpecMessages 仍返回空 roundB。
      subs.get('roundB')?.({ type: 'turn-completed' } as SessionEvent)
      host.settleList([
        { id: 'roundB', title: 'B', specId: S, running: false, createdAt: 10, updatedAt: 11 },
        { id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 },
      ])
      await tick(220)

      // 实时内容仍在（没有被空读回退成只剩 roundA）。
      expect(host.snapshot()).toContain('assistant:ROUND-A-OUTROUND-B-OUT')
    } finally {
      host.dispose()
    }
  })
})

describe('createChatTranscript · 追加任务乐观 push', () => {
  it('切到新一轮即显示隔离线 + /yorz-spec 用户气泡，实时输出落在其后', async () => {
    const host = mountDesktopHost()
    try {
      await openWithRoundA(host)

      // 追加任务：后端已建 roundB 起 run；前端切过去并乐观 push。
      specMessages = [roundA, { sessionId: 'roundB', kind: 'claude', createdAt: 10, messages: [] }]
      host.selectSession('roundB')
      host.tx.beginOptimisticRound('roundB', '/yorz-spec refct', 'claude')
      host.settleList([
        { id: 'roundB', title: 'B', specId: S, running: true, createdAt: 10, updatedAt: 10 },
        { id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 },
      ])
      await tick()

      // 还没有任何实时输出，隔离线与用户气泡就已上屏。
      expect(host.snapshot()).toEqual([
        'assistant:ROUND-A-OUT',
        'divider:claude',
        'user:/yorz-spec refct',
      ])

      // 实时输出落在用户气泡之后（不再合并进上一轮）。
      subs.get('roundB')?.({ type: 'text', delta: 'ROUND-B-OUT' } as SessionEvent)
      await tick()
      expect(host.snapshot()).toEqual([
        'assistant:ROUND-A-OUT',
        'divider:claude',
        'user:/yorz-spec refct',
        'assistant:ROUND-B-OUT',
      ])

      // 本轮结束：真实 transcript 折入并替换乐观副本，不重复。
      specMessages = [
        roundA,
        {
          sessionId: 'roundB',
          kind: 'claude',
          createdAt: 10,
          messages: [user('/yorz-spec refct'), assistant('ROUND-B-OUT')],
        },
      ]
      subs.get('roundB')?.({ type: 'turn-completed' } as SessionEvent)
      host.settleList([
        { id: 'roundB', title: 'B', specId: S, running: false, createdAt: 10, updatedAt: 11 },
        { id: 'roundA', title: 'A', specId: S, createdAt: 1, updatedAt: 5 },
      ])
      await tick(220)
      expect(host.snapshot()).toEqual([
        'assistant:ROUND-A-OUT',
        'divider:claude',
        'user:/yorz-spec refct',
        'assistant:ROUND-B-OUT',
      ])
    } finally {
      host.dispose()
    }
  })
})
