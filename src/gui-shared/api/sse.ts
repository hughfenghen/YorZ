import type { CommandRun, GitChange } from './index.js'
import { appendAuthToken, withAuthHeaders } from './auth.js'

export interface ServerHeartbeatEvent {
  ts: number
}

// The unsubscribe function returned by subscribe*() also carries a `readyState`
// probe so callers can tell whether the underlying EventSource is currently OPEN.
export interface SseSubscription {
  (): void
  readyState: () => number
}

// =============================================================================
// Multiplexed SSE
// =============================================================================
//
// All realtime events go through ONE EventSource per tab. Callers subscribe to
// named "topics" — the mux batches topic changes into a single POST to
// `/api/events/subscribe`, and dispatches incoming `msg` frames to the
// registered handlers by topic.
//
// Motivation: browsers cap HTTP/1.1 connections at 6 per origin. Opening
// several tabs / SSE-heavy pages used to saturate the budget and leave later
// `fetch` calls perpetually pending.

type TopicHandler = (event: string, data: unknown) => void

// --- 看门狗参数 ---
// 服务端每 HEARTBEAT_INTERVAL_MS(5s) 发一次 `server-heartbeat`，所以「连续多久没有
// 任何帧」是判定连接是否还活着的可靠信号。给 3 个心跳周期的余量，避免主线程卡顿
// 或后台标签页定时器被节流时误判重连。
const STALE_AFTER_MS = 16_000
const WATCHDOG_INTERVAL_MS = 5_000

function generateClientId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

class SseMultiplex {
  private clientId = generateClientId()
  private source: EventSource | null = null
  private handlers = new Map<string, Set<TopicHandler>>()
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private syncInFlight = false
  private syncPending = false
  private lastFrameAt = 0
  private watchdogTimer: ReturnType<typeof setInterval> | null = null
  private visibilityBound = false

  subscribe(topic: string, handler: TopicHandler): () => void {
    let set = this.handlers.get(topic)
    if (!set) {
      set = new Set()
      this.handlers.set(topic, set)
    }
    set.add(handler)
    this.ensureOpen()
    this.scheduleSync()
    return () => {
      const s = this.handlers.get(topic)
      if (!s) return
      s.delete(handler)
      if (s.size === 0) this.handlers.delete(topic)
      this.scheduleSync()
    }
  }

  readyState(): number {
    return this.source?.readyState ?? 2 // EventSource.CLOSED
  }

  private ensureOpen(): void {
    if (this.source) return
    const url = appendAuthToken(`/api/events/stream?clientId=${encodeURIComponent(this.clientId)}`)
    const source = new EventSource(url)
    this.source = source
    this.lastFrameAt = Date.now()
    this.startWatchdog()
    source.addEventListener('open', () => {
      this.lastFrameAt = Date.now()
      // On (re)connect the server has a fresh session — flush our topics.
      this.scheduleSync(true)
    })
    source.addEventListener('server-heartbeat', (e) => {
      this.lastFrameAt = Date.now()
      let data: unknown = { ts: Date.now() }
      try {
        data = JSON.parse((e as MessageEvent).data)
      } catch {
        // keep fallback
      }
      // Dispatch heartbeat to every subscribed handler — the watchdog uses it
      // to refresh lastEventAt regardless of topic.
      for (const set of this.handlers.values()) {
        for (const h of set) {
          try {
            h('server-heartbeat', data)
          } catch {
            // handler errors must not break dispatch
          }
        }
      }
    })
    source.addEventListener('msg', (e) => {
      this.lastFrameAt = Date.now()
      let payload: { topic: string; event: string; data: unknown }
      try {
        payload = JSON.parse((e as MessageEvent).data)
      } catch {
        return
      }
      const set = this.handlers.get(payload.topic)
      if (!set) return
      for (const h of set) {
        try {
          h(payload.event, payload.data)
        } catch {
          // handler errors must not break dispatch
        }
      }
    })
    source.addEventListener('error', () => {
      // 不在这里重连：浏览器对「网络层断开」本就会自己重试（readyState 回到
      // CONNECTING）；而 HTTP 错误码（反向代理在后端不可用时回的 500/502）会让它
      // 直接进入 CLOSED 且永不重试——那种情况由看门狗按固定节奏接管，避免在这里
      // 同步重连打成一个高频空转的重试风暴。
    })
  }

  // ---------------------------------------------------------------------------
  // 连接看门狗
  // ---------------------------------------------------------------------------
  //
  // 为什么不能只信 EventSource 自己的重连：Service 重启时，如果中间隔着反向代理
  // （dev 的 vite proxy、移动端的 tailscale serve），代理与后端的上游连接断了，但
  // 浏览器 ↔ 代理这一段仍保持打开。此时 EventSource 停在 readyState === OPEN，既不
  // 报 error 也不重连，成为一条永不再有数据的「僵尸连接」——页面上所有实时更新
  // （项目列表 / spec 列表 / 会话状态 / 命令输出）从此静默失效，直到用户手动刷新。
  //
  // 服务端每 5s 一次的 `server-heartbeat` 正是为此准备的活性信号：只要连续
  // STALE_AFTER_MS 没有任何帧，就判定连接已死并强制重建（新 EventSource 的 open
  // 会触发 scheduleSync(true)，把全部 topic 重新订阅回去）。

  private startWatchdog(): void {
    if (this.watchdogTimer === null) {
      const timer = setInterval(() => this.checkAlive(), WATCHDOG_INTERVAL_MS)
      ;(timer as { unref?: () => void }).unref?.()
      this.watchdogTimer = timer
    }
    // 后台标签页的定时器会被浏览器节流到分钟级，回到前台时立即补一次检查，
    // 避免用户切回来后还要干等一个节流周期。
    if (!this.visibilityBound && typeof document !== 'undefined') {
      this.visibilityBound = true
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.checkAlive()
      })
    }
  }

  private checkAlive(): void {
    const source = this.source
    if (!source) return
    const stale = Date.now() - this.lastFrameAt > STALE_AFTER_MS
    // CLOSED 表示浏览器已彻底放弃该连接（例如代理回了 HTTP 错误码），必须我们自己重建。
    const dead = source.readyState === 2
    if (!stale && !dead) return
    this.reconnect()
  }

  private reconnect(): void {
    const source = this.source
    this.source = null
    try {
      source?.close()
    } catch {
      // best-effort
    }
    this.ensureOpen()
  }

  private scheduleSync(immediate: boolean = false): void {
    if (this.syncTimer) return
    const delay = immediate ? 0 : 20
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      void this.runSync()
    }, delay)
  }

  private async runSync(): Promise<void> {
    if (this.syncInFlight) {
      this.syncPending = true
      return
    }
    this.syncInFlight = true
    try {
      const topics = [...this.handlers.keys()].sort()
      await fetch(
        '/api/events/subscribe',
        withAuthHeaders({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId: this.clientId, topics }),
        }),
      )
    } catch {
      // network error; a later scheduleSync (or reconnect open) will retry
    } finally {
      this.syncInFlight = false
      if (this.syncPending) {
        this.syncPending = false
        this.scheduleSync(true)
      }
    }
  }

  /** 关掉连接与看门狗定时器。仅测试用——生产里 mux 与页面同生命周期。 */
  dispose(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer)
      this.syncTimer = null
    }
    try {
      this.source?.close()
    } catch {
      // best-effort
    }
    this.source = null
    this.handlers.clear()
  }
}

// Overridable for tests (mux is stateful and would leak across cases otherwise).
let mux = new SseMultiplex()
export function __resetMuxForTests(): void {
  mux.dispose()
  mux = new SseMultiplex()
}

function makeSubscription(unsubscribe: () => void): SseSubscription {
  const s = unsubscribe as SseSubscription
  s.readyState = () => mux.readyState()
  return s
}

// =============================================================================
// Public subscription API (kept intentionally identical to the pre-mux version)
// =============================================================================

export interface SpecSubscribeHandlers {
  onUpdated?: () => void
  onServerHeartbeat?: (e: ServerHeartbeatEvent) => void
}

export function subscribeSpec(
  pid: string,
  id: string,
  handlers: SpecSubscribeHandlers,
): SseSubscription {
  if (!pid) {
    const noop = (() => {}) as SseSubscription
    noop.readyState = () => 2
    return noop
  }
  const topic = `project:${pid}:spec:${id}`
  const unsub = mux.subscribe(topic, (event, data) => {
    switch (event) {
      case 'updated':
        handlers.onUpdated?.()
        break
      case 'server-heartbeat':
        handlers.onServerHeartbeat?.(data as ServerHeartbeatEvent)
        break
    }
  })
  return makeSubscription(unsub)
}

export type SessionEvent =
  | { type: 'session-started'; sessionId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool-use'; name: string; input: unknown }
  | { type: 'tool-result'; text: string }
  | { type: 'turn-completed'; usage?: unknown }
  /**
   * Context was compacted mid-turn (auto or manual). The server has always
   * emitted this (`agent-sdk/types.ts`, passed through by the events hub) but
   * the client union omitted it, so every consumer's if-else chain dropped it
   * silently. Declared here so that stays a rendering choice, not an accident;
   * `metrics` is the adapter's `CompactMetrics`, kept opaque on this side.
   */
  | { type: 'compact'; metrics: unknown }
  | { type: 'error'; message: string }

export interface SessionReadyEvent {
  sessionId: string
}

export interface SessionSubscribeHandlers {
  onEvent?: (e: SessionEvent) => void
  /**
   * The server has attached this session's topic and every subsequent turn event
   * will reach us. The session stream has NO replay buffer, so a caller that
   * creates a session and immediately POSTs a message would race its own
   * subscription and lose the early text deltas — gate the POST on this.
   */
  onReady?: (e: SessionReadyEvent) => void
  onServerHeartbeat?: (e: ServerHeartbeatEvent) => void
}

export function subscribeSession(
  pid: string,
  sid: string,
  handlers: SessionSubscribeHandlers,
): SseSubscription {
  if (!pid) {
    const noop = (() => {}) as SseSubscription
    noop.readyState = () => 2
    return noop
  }
  const topic = `project:${pid}:session:${sid}`
  const unsub = mux.subscribe(topic, (event, data) => {
    if (event === 'session-msg') handlers.onEvent?.(data as SessionEvent)
    else if (event === 'ready') handlers.onReady?.(data as SessionReadyEvent)
    else if (event === 'server-heartbeat')
      handlers.onServerHeartbeat?.(data as ServerHeartbeatEvent)
  })
  return makeSubscription(unsub)
}

export interface SessionStatusEvent {
  sessionId: string
  running: boolean
}

export interface SessionsSubscribeHandlers {
  onStatus?: (e: SessionStatusEvent) => void
  onServerHeartbeat?: (e: ServerHeartbeatEvent) => void
}

/** Project-level topic: run status of every session (drives the list spinner). */
export function subscribeSessions(
  pid: string,
  handlers: SessionsSubscribeHandlers,
): SseSubscription {
  if (!pid) {
    const noop = (() => {}) as SseSubscription
    noop.readyState = () => 2
    return noop
  }
  const topic = `project:${pid}:sessions`
  const unsub = mux.subscribe(topic, (event, data) => {
    if (event === 'session-status') handlers.onStatus?.(data as SessionStatusEvent)
    else if (event === 'server-heartbeat')
      handlers.onServerHeartbeat?.(data as ServerHeartbeatEvent)
  })
  return makeSubscription(unsub)
}

export function subscribeSpecsList(pid: string, onChange: () => void): () => void {
  if (!pid) return () => {}
  const topic = `project:${pid}:specs`
  return mux.subscribe(topic, (event) => {
    if (event === 'list-updated') onChange()
  })
}

export function subscribeProjectsList(onChange: () => void): () => void {
  return mux.subscribe('projects', (event) => {
    if (event === 'projects-changed') onChange()
  })
}

export function subscribeSystemNotifications(onChange: () => void): () => void {
  return mux.subscribe('system-notifications', (event) => {
    if (event === 'updated') onChange()
  })
}

/** Project-level topic: the full run list, re-sent on every change. */
export function subscribeCommandRuns(
  pid: string,
  onUpdate: (runs: CommandRun[]) => void,
): () => void {
  if (!pid) return () => {}
  const topic = `project:${pid}:commands`
  return mux.subscribe(topic, (event, data) => {
    if (event === 'runs-updated') onUpdate((data as { runs: CommandRun[] }).runs)
  })
}

export interface CommandOutputChunk {
  offset: number
  chunk: string
}

export interface CommandRunSubscribeHandlers {
  onOutput?: (c: CommandOutputChunk) => void
  onRun?: (run: CommandRun) => void
  onError?: (message: string) => void
}

/** Per-run topic: incremental stdout plus terminal status transitions. */
export function subscribeCommandOutput(
  pid: string,
  runId: string,
  handlers: CommandRunSubscribeHandlers,
): () => void {
  if (!pid || !runId) return () => {}
  const topic = `project:${pid}:command:${runId}`
  return mux.subscribe(topic, (event, data) => {
    if (event === 'output-appended') handlers.onOutput?.(data as CommandOutputChunk)
    else if (event === 'run-updated') handlers.onRun?.((data as { run: CommandRun }).run)
    else if (event === 'ready') {
      const run = (data as { run?: CommandRun }).run
      if (run) handlers.onRun?.(run)
    } else if (event === 'error') {
      handlers.onError?.(String((data as { error?: string }).error ?? 'unknown error'))
    }
  })
}

/**
 * Repo-wide git working-tree changes. The topic carries no spec id — the server
 * watcher is keyed on the project path — so every git surface shares one stream.
 */
export function subscribeProjectChanges(
  pid: string,
  onUpdate: (changes: GitChange[]) => void,
): SseSubscription {
  if (!pid) {
    const noop = (() => {}) as SseSubscription
    noop.readyState = () => 2
    return noop
  }
  const topic = `project:${pid}:changes`
  const unsub = mux.subscribe(topic, (event, data) => {
    if (event === 'changes-updated') {
      const payload = data as { changes: GitChange[] }
      onUpdate(payload.changes)
    }
  })
  return makeSubscription(unsub)
}
