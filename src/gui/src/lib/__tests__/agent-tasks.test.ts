import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeHandlers {
  onAgentStdout?: (e: { runId: string; mode: string; specId: string; chunk: string }) => void
  onAgentExit?: (e: { runId: string; mode: string; specId: string; code: number | null }) => void
  onAgentError?: (e: { runId: string; mode: string; specId: string; message: string }) => void
  onServerHeartbeat?: (e: { ts: number }) => void
}

interface FakeSub {
  runId: string
  handlers: FakeHandlers
  readyState: number
  unsubscribed: boolean
}

const subs: FakeSub[] = []

vi.mock('../sse.js', () => {
  return {
    cancelRun: vi.fn(async (_pid: string, _runId: string) => {}),
    fetchActiveRuns: vi.fn(async (_pid: string) => []),
    subscribeRun: (_pid: string, runId: string, handlers: FakeHandlers) => {
      const entry: FakeSub = { runId, handlers, readyState: 1, unsubscribed: false }
      subs.push(entry)
      const unsub = (() => {
        entry.unsubscribed = true
      }) as (() => void) & { readyState: () => number }
      unsub.readyState = () => entry.readyState
      return unsub
    },
  }
})

import { createAgentTasks, STALE_AFTER_MS, WATCHDOG_TICK_MS } from '../agent-tasks.js'

beforeEach(() => {
  subs.length = 0
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function startSampleTask() {
  const tasks = createAgentTasks()
  tasks.start({
    runId: 'r1',
    projectId: 'p1',
    mode: 'skill-run',
    specId: 's1',
    source: 'run',
  })
  return tasks
}

describe('agent-tasks watchdog', () => {
  it('marks the task failed when SSE is silent past STALE_AFTER_MS and EventSource is not OPEN', async () => {
    const tasks = startSampleTask()
    const sub = subs[0]
    expect(tasks.state.tasks['r1'].status).toBe('pending')

    // Simulate EventSource transitioning to CLOSED (e.g. server died).
    sub.readyState = 2

    await vi.advanceTimersByTimeAsync(STALE_AFTER_MS + WATCHDOG_TICK_MS)

    const t = tasks.state.tasks['r1']
    expect(t.status).toBe('failed')
    expect(t.error).toBe('Server 失联，任务可能已终止')
    expect(sub.unsubscribed).toBe(true)
  })

  it('does not mark stale while EventSource stays OPEN even without traffic', async () => {
    const tasks = startSampleTask()
    const sub = subs[0]
    sub.readyState = 1
    await vi.advanceTimersByTimeAsync(STALE_AFTER_MS * 2)
    expect(tasks.state.tasks['r1'].status).toBe('pending')
  })

  it('heartbeat refreshes lastEventAt to avoid stale flip', async () => {
    const tasks = startSampleTask()
    const sub = subs[0]
    sub.readyState = 2

    // Tick almost-stale, then heartbeat refreshes; another almost-stale must not trip.
    await vi.advanceTimersByTimeAsync(STALE_AFTER_MS - WATCHDOG_TICK_MS)
    sub.handlers.onServerHeartbeat?.({ ts: Date.now() })
    await vi.advanceTimersByTimeAsync(STALE_AFTER_MS - WATCHDOG_TICK_MS)
    expect(tasks.state.tasks['r1'].status).toBe('pending')

    // Now let it actually go stale.
    await vi.advanceTimersByTimeAsync(STALE_AFTER_MS)
    expect(tasks.state.tasks['r1'].status).toBe('failed')
  })
})

describe('reconcileWithActive', () => {
  it('flips local pending/streaming tasks that are missing from the active list', () => {
    const tasks = startSampleTask()
    tasks.reconcileWithActive(new Set<string>())
    const t = tasks.state.tasks['r1']
    expect(t.status).toBe('failed')
    expect(t.error).toBe('Server 已重启，原任务未恢复')
    expect(subs[0].unsubscribed).toBe(true)
  })

  it('keeps tasks that are present in the active list', () => {
    const tasks = startSampleTask()
    tasks.reconcileWithActive(new Set<string>(['r1']))
    expect(tasks.state.tasks['r1'].status).toBe('pending')
    expect(subs[0].unsubscribed).toBe(false)
  })
})
