import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  AgentEvent,
  AgentSdkAdapter,
  AgentSession,
  NormalizedMessage,
  SessionInfo,
} from '../agent-sdk/types.js'
import { SESSION_LIST_LIMIT, SessionManager } from '../session-manager.js'
import { SessionStore } from '../session-store.js'

/** Adapter double: `listSessions()` stands in for on-disk transcripts. */
function fakeAdapter(opts: {
  native?: SessionInfo[]
  messages?: Record<string, NormalizedMessage[]>
  onSend?: (prompt: string) => AsyncIterable<AgentEvent>
}): AgentSdkAdapter {
  const makeSession = (id: string): AgentSession => ({
    id,
    send: (prompt: string) =>
      opts.onSend?.(prompt) ??
      (async function* () {
        yield { type: 'turn-completed' } satisfies AgentEvent
      })(),
    abort: () => {},
  })
  return {
    kind: 'claude',
    createSession: async () => makeSession('created'),
    resumeSession: async (id: string) => makeSession(id),
    listSessions: async () => opts.native ?? [],
    getMessages: async (id: string) => opts.messages?.[id] ?? [],
    capabilities: () => ({ listSessions: true, getMessages: true }),
  }
}

async function makeManager(adapter: AgentSdkAdapter): Promise<{
  mgr: SessionManager
  store: SessionStore
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-sm-'))
  const store = new SessionStore(cwd)
  const mgr = new SessionManager(cwd, 'claude', store)
  // Only the 'claude' adapter is exercised; the other kinds resolve to the same
  // double, which reports the same (empty by default) native listing.
  ;(mgr as unknown as { adapters: { get: () => AgentSdkAdapter } }).adapters = {
    get: () => adapter,
  }
  return { mgr, store }
}

const info = (over: Partial<SessionInfo> & { id: string }): SessionInfo => ({
  title: over.id,
  kind: 'claude',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
})

const textMessage = (text = 'hello'): NormalizedMessage => ({
  role: 'assistant',
  parts: [{ type: 'text', text }],
})

describe('SessionManager.listSessions', () => {
  it('drops ghost sessions (indexed, never ran a turn, no transcript)', async () => {
    const { mgr, store } = await makeManager(
      fakeAdapter({ native: [], messages: { real: [textMessage()] } }),
    )
    // Ghost: created by an old get-or-create probe, never sent a turn.
    await store.upsert(info({ id: 'ghost', createdAt: 5, updatedAt: 5 }))
    // Real: touch() bumped updatedAt past createdAt, so a turn did run.
    await store.upsert(info({ id: 'real', createdAt: 5, updatedAt: 9 }))

    const list = await mgr.listSessions()
    expect(list.map((s) => s.id)).toEqual(['real'])
  })

  it('keeps indexed sessions that have a transcript on the adapter side', async () => {
    const native = [info({ id: 'ghost-but-on-disk', createdAt: 5, updatedAt: 5 })]
    const { mgr, store } = await makeManager(
      fakeAdapter({
        native,
        messages: {
          'ghost-but-on-disk': [textMessage()],
        },
      }),
    )
    await store.upsert(info({ id: 'ghost-but-on-disk', createdAt: 5, updatedAt: 5 }))

    const list = await mgr.listSessions()
    expect(list.map((s) => s.id)).toEqual(['ghost-but-on-disk'])
  })

  it('merges native sessions and truncates to the most recent SESSION_LIST_LIMIT', async () => {
    const native = Array.from({ length: SESSION_LIST_LIMIT + 12 }, (_, i) =>
      info({ id: `n${i}`, createdAt: i, updatedAt: i }),
    )
    const messages = Object.fromEntries(native.map((s) => [s.id, [textMessage(s.id)]]))
    const { mgr } = await makeManager(fakeAdapter({ native, messages }))

    const list = await mgr.listSessions()
    expect(list).toHaveLength(SESSION_LIST_LIMIT)
    // Sorted by updatedAt desc: the newest id wins, the oldest is cut.
    expect(list[0].id).toBe(`n${SESSION_LIST_LIMIT + 11}`)
    expect(list.map((s) => s.id)).not.toContain('n0')
  })
})

describe('SessionManager per-spec sessions', () => {
  it('findSessionForSpec does not create a session when none is bound', async () => {
    const { mgr, store } = await makeManager(fakeAdapter({}))

    expect(await mgr.findSessionForSpec('spec-a')).toBeNull()
    expect(await store.list()).toHaveLength(0)
  })

  it('ensureSessionForSpec creates once and reuses afterwards', async () => {
    const { mgr, store } = await makeManager(fakeAdapter({}))

    const first = await mgr.ensureSessionForSpec('spec-a')
    const second = await mgr.ensureSessionForSpec('spec-a')

    expect(second.sessionId).toBe(first.sessionId)
    expect(await store.list()).toHaveLength(1)
    expect(await mgr.findSessionForSpec('spec-a')).toEqual(first)
  })
})

describe('SessionManager run status', () => {
  it('marks a session running for the duration of a turn and broadcasts both edges', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      release = r
    })
    const adapter = fakeAdapter({
      messages: { 'sid-1': [textMessage()] },
      onSend: async function* () {
        yield { type: 'text', delta: 'hi' } satisfies AgentEvent
        await gate
        yield { type: 'turn-completed' } satisfies AgentEvent
      },
    })
    const { mgr, store } = await makeManager(adapter)
    await store.upsert(info({ id: 'sid-1', createdAt: 5, updatedAt: 9 }))

    const events: Array<{ sessionId: string; running: boolean }> = []
    mgr.subscribeStatus((ev) => events.push(ev))

    const handle = mgr.send('sid-1', 'hello')
    expect(mgr.isRunning('sid-1')).toBe(true)
    expect(events).toEqual([{ sessionId: 'sid-1', running: true }])
    expect((await mgr.listSessions()).find((s) => s.id === 'sid-1')?.running).toBe(true)

    const done = new Promise<void>((r) => handle.onDone(() => r()))
    release?.()
    await done

    expect(mgr.isRunning('sid-1')).toBe(false)
    expect(events).toEqual([
      { sessionId: 'sid-1', running: true },
      { sessionId: 'sid-1', running: false },
    ])
    expect((await mgr.listSessions()).find((s) => s.id === 'sid-1')?.running).toBe(false)
  })
})
