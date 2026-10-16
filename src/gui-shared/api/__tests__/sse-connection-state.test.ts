import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetMuxForTests, subscribeConnectionState } from '../sse.js'

/**
 * 复用 watchdog 测试的最小 EventSource 替身：不会自己重连，readyState 可被手动驱动，
 * 用来模拟「Service 进程中断 → 持续无帧 → 看门狗判死」的断连场景。
 */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 0
  closed = false
  private listeners = new Map<string, Set<(e: unknown) => void>>()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(cb)
  }

  close(): void {
    this.closed = true
    this.readyState = 2
  }

  private dispatch(type: string, data?: string): void {
    for (const cb of this.listeners.get(type) ?? []) cb({ data } as unknown)
  }

  emitOpen(): void {
    this.readyState = 1
    this.dispatch('open')
  }

  emitHeartbeat(): void {
    this.dispatch('server-heartbeat', JSON.stringify({ ts: 1 }))
  }

  emitMsg(topic: string, event: string, data: unknown = {}): void {
    this.dispatch('msg', JSON.stringify({ topic, event, data }))
  }
}

const g = globalThis as unknown as { EventSource?: unknown; fetch?: unknown }
let origEventSource: unknown
let origFetch: unknown

beforeEach(() => {
  vi.useFakeTimers()
  FakeEventSource.instances = []
  origEventSource = g.EventSource
  origFetch = g.fetch
  g.EventSource = FakeEventSource
  g.fetch = vi.fn(async () => ({ ok: true }) as unknown)
  __resetMuxForTests()
})

afterEach(() => {
  __resetMuxForTests()
  g.EventSource = origEventSource
  g.fetch = origFetch
  vi.useRealTimers()
})

const latest = (): FakeEventSource =>
  FakeEventSource.instances[FakeEventSource.instances.length - 1]!

describe('SseMultiplex 连接健康信号', () => {
  it('订阅即立刻回调当前值，并主动拉起 EventSource', () => {
    const seen: boolean[] = []
    subscribeConnectionState((c) => seen.push(c))
    // 乐观初值 true + 强制 ensureOpen（即便无业务订阅也能探活）。
    expect(seen).toEqual([true])
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('长时间无帧被看门狗判死时通知 connected=false', async () => {
    const seen: boolean[] = []
    subscribeConnectionState((c) => seen.push(c))
    latest().emitOpen()
    await vi.advanceTimersByTimeAsync(50)

    // 模拟 Service 中断：连接不报 error、无任何帧，超过 STALE_AFTER_MS 后判死。
    await vi.advanceTimersByTimeAsync(20_000)
    expect(seen.at(-1)).toBe(false)
  })

  it('断连阈值(5s)与重连阈值(16s)解耦：先置断、不立即重连', async () => {
    const seen: boolean[] = []
    subscribeConnectionState((c) => seen.push(c))
    latest().emitOpen()
    await vi.advanceTimersByTimeAsync(50)

    // 静默约 10s：已越过 5s 断连阈值 → UI 置断；但未到 16s → 不重连。
    await vi.advanceTimersByTimeAsync(10_000)
    expect(seen.at(-1)).toBe(false)
    expect(FakeEventSource.instances).toHaveLength(1)

    // 继续静默越过 16s → 看门狗重建连接。
    await vi.advanceTimersByTimeAsync(10_000)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('重连后收到帧时恢复为 connected=true', async () => {
    const seen: boolean[] = []
    subscribeConnectionState((c) => seen.push(c))
    latest().emitOpen()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(seen.at(-1)).toBe(false)

    // 看门狗重建连接，新连接收到帧 → 恢复在线。
    latest().emitOpen()
    latest().emitHeartbeat()
    expect(seen.at(-1)).toBe(true)
  })

  it('心跳持续到达时不翻转（仅变化时通知，避免每拍广播）', async () => {
    const seen: boolean[] = []
    subscribeConnectionState((c) => seen.push(c))
    latest().emitOpen()
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(5_000)
      latest().emitHeartbeat()
    }
    // 自始至终在线，只有订阅时那一次 true。
    expect(seen).toEqual([true])
  })

  it('注销后不再收到状态通知', async () => {
    const seen: boolean[] = []
    const unsub = subscribeConnectionState((c) => seen.push(c))
    latest().emitOpen()
    unsub()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(seen).toEqual([true])
  })
})
