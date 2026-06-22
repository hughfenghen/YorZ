import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachHeartbeat, HEARTBEAT_INTERVAL_MS } from '../routes/events.js'

interface FakeStream {
  writes: string[]
  sse: Array<{ event: string; data: string }>
  write: (s: string) => Promise<void>
  writeSSE: (m: { event: string; data: string }) => Promise<void>
}

function makeFakeStream(opts: { failAfter?: number } = {}): FakeStream {
  const fs: FakeStream = {
    writes: [],
    sse: [],
    write: async (s: string) => {
      if (opts.failAfter != null && fs.writes.length >= opts.failAfter) {
        throw new Error('stream closed')
      }
      fs.writes.push(s)
    },
    writeSSE: async (m) => {
      fs.sse.push(m)
    },
  }
  return fs
}

describe('attachHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes a keep-alive comment and server-heartbeat event every interval', async () => {
    const stream = makeFakeStream()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stop = attachHeartbeat(stream as any)

    expect(stream.writes).toHaveLength(0)
    expect(stream.sse).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
    expect(stream.writes).toEqual([': keep-alive\n\n'])
    expect(stream.sse).toHaveLength(1)
    expect(stream.sse[0].event).toBe('server-heartbeat')
    const payload = JSON.parse(stream.sse[0].data)
    expect(typeof payload.ts).toBe('number')

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2)
    expect(stream.sse).toHaveLength(3)

    stop()
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 5)
    expect(stream.sse).toHaveLength(3)
  })

  it('swallows write errors so a closed stream does not throw', async () => {
    const stream = makeFakeStream({ failAfter: 0 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stop = attachHeartbeat(stream as any)
    await expect(vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2)).resolves.toBeDefined()
    stop()
    expect(stream.writes).toHaveLength(0)
  })
})
