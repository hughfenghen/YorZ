import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  AgentEvent,
  AgentKind,
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
  onAbort?: () => void
  usageStatus?: AgentSdkAdapter['getUsageStatus']
  usageStatusCapable?: boolean
}): AgentSdkAdapter {
  const makeSession = (id: string): AgentSession => ({
    id,
    send: (prompt: string) =>
      opts.onSend?.(prompt) ??
      (async function* () {
        yield { type: 'turn-completed' } satisfies AgentEvent
      })(),
    abort: () => opts.onAbort?.(),
  })
  return {
    kind: 'claude',
    createSession: async () => makeSession('created'),
    resumeSession: async (id: string) => makeSession(id),
    listSessions: async () => opts.native ?? [],
    getMessages: async (id: string) => opts.messages?.[id] ?? [],
    getUsageStatus: opts.usageStatus,
    capabilities: () => ({
      listSessions: true,
      getMessages: true,
      usageStatus: opts.usageStatusCapable ?? Boolean(opts.usageStatus),
    }),
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
  ;(
    mgr as unknown as {
      adapters: { get: () => AgentSdkAdapter; dispose: () => Promise<void> }
    }
  ).adapters = {
    get: () => adapter,
    dispose: async () => {},
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

  it('prefers native readable titles over indexed UUID titles', async () => {
    const id = '7a8bf735-f701-4dfc-a5da-e68bc8b19761'
    const native = [info({ id, title: 'Improve chat session list', createdAt: 5, updatedAt: 9 })]
    const { mgr, store } = await makeManager(fakeAdapter({ native }))
    await store.upsert(info({ id, title: id, createdAt: 5, updatedAt: 12 }))

    const list = await mgr.listSessions()

    expect(list.find((s) => s.id === id)?.title).toBe('Improve chat session list')
    expect(list.find((s) => s.id === id)?.updatedAt).toBe(12)
  })

  it('treats UUIDv7-looking titles as opaque when merging native titles', async () => {
    const id = '019f9858-1fa6-7550-b514-7de5300c3a0b'
    const native = [info({ id, title: 'hello', createdAt: 5, updatedAt: 9 })]
    const { mgr, store } = await makeManager(fakeAdapter({ native }))
    await store.upsert(
      info({
        id,
        title: '019f9820-75ce-79a2-acb7-3d64a61f64d7',
        createdAt: 5,
        updatedAt: 12,
      }),
    )

    const list = await mgr.listSessions()

    expect(list.find((s) => s.id === id)?.title).toBe('hello')
  })
})

describe('SessionManager.getMessages', () => {
  /** One adapter per kind, so routing — not the double — decides the answer. */
  async function managerWith(
    defaultKind: AgentKind,
    byKind: Partial<Record<AgentKind, AgentSdkAdapter>>,
  ): Promise<SessionManager> {
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-sm-'))
    const empty = fakeAdapter({})
    const mgr = new SessionManager(cwd, defaultKind, new SessionStore(cwd))
    ;(mgr as unknown as { adapters: { get: (k: AgentKind) => AgentSdkAdapter } }).adapters = {
      get: (k) => byKind[k] ?? empty,
    }
    return mgr
  }

  // In every case the transcript lives on one adapter while `defaultKind` points
  // at a different one, so falling back to `defaultKind` yields nothing.
  const cases: Array<{ owner: AgentKind; defaultKind: AgentKind }> = [
    { owner: 'claude', defaultKind: 'codex' },
    { owner: 'codex', defaultKind: 'claude' },
    { owner: 'opencode', defaultKind: 'claude' },
  ]
  for (const { owner, defaultKind } of cases) {
    it(`routes an externally created ${owner} session to the ${owner} adapter`, async () => {
      const mgr = await managerWith(defaultKind, {
        [owner]: fakeAdapter({
          native: [info({ id: 'external-1', kind: owner })],
          messages: { 'external-1': [textMessage()] },
        }),
      })

      // No listSessions() first: the GUI loads history and the session list
      // concurrently, so getMessages has to resolve the kind on its own.
      expect(await mgr.getMessages('external-1')).toEqual([textMessage()])
    })
  }

  it('lets the first adapter that claims an id win, matching the listing', async () => {
    const claiming = (kind: AgentKind, messages: NormalizedMessage[]) =>
      fakeAdapter({ native: [info({ id: 'dup', kind })], messages: { dup: messages } })
    const mgr = await managerWith('claude', {
      claude: claiming('claude', [textMessage('from claude')]),
      codex: claiming('codex', [textMessage('from codex')]),
    })

    const [listed] = await mgr.listSessions()
    expect(listed.kind).toBe('claude')
    expect(await mgr.getMessages('dup')).toEqual([textMessage('from claude')])
  })
})

describe('SessionManager.getUsageStatus', () => {
  it('returns unavailable when the adapter has no usage status capability', async () => {
    const { mgr } = await makeManager(fakeAdapter({ usageStatusCapable: false }))

    const status = await mgr.getUsageStatus()

    expect(status).toMatchObject({ kind: 'claude', status: 'unavailable' })
  })

  it('returns adapter usage status when supported', async () => {
    const { mgr } = await makeManager(
      fakeAdapter({
        usageStatusCapable: true,
        usageStatus: async () => ({
          kind: 'claude',
          status: 'available',
          checkedAt: 123,
          rateLimitsAvailable: true,
          windows: [{ key: 'five_hour', label: '5-hour', utilization: 42, resetsAt: null }],
        }),
      }),
    )

    const status = await mgr.getUsageStatus()

    expect(status).toMatchObject({
      kind: 'claude',
      status: 'available',
      windows: [{ key: 'five_hour', utilization: 42 }],
    })
  })

  it('converts adapter usage status throws into error status', async () => {
    const { mgr } = await makeManager(
      fakeAdapter({
        usageStatusCapable: true,
        usageStatus: async () => {
          throw new Error('usage failed')
        },
      }),
    )

    const status = await mgr.getUsageStatus()

    expect(status).toMatchObject({ kind: 'claude', status: 'error', message: 'usage failed' })
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

  it('bindSessionToSpec binds an existing draft session and updates title', async () => {
    const { mgr, store } = await makeManager(fakeAdapter({}))
    const created = await mgr.createSession(undefined, '')

    const ok = await mgr.bindSessionToSpec(created.sessionId, 'spec-a', 'spec-a · useful summary')

    expect(ok).toBe(true)
    expect(await mgr.findSessionForSpec('spec-a')).toEqual(created)
    expect((await store.get(created.sessionId))?.title).toBe('spec-a · useful summary')
  })
})

describe('SessionManager run status', () => {
  it('uses the first prompt as the title for an untitled Codex draft session', async () => {
    const realId = '019f9858-1fa6-7550-b514-7de5300c3a0b'
    const adapter = fakeAdapter({
      onSend: async function* () {
        yield { type: 'session-started', sessionId: realId } satisfies AgentEvent
        yield { type: 'turn-completed' } satisfies AgentEvent
      },
    })
    const { mgr, store } = await makeManager(adapter)
    const created = await mgr.createSession()

    const handle = await mgr.send(created.sessionId, 'hello')
    await new Promise<void>((r) => handle.onDone(() => r()))

    expect(await store.get(created.sessionId)).toBeUndefined()
    expect((await store.get(realId))?.title).toBe('hello')
  })

  it('onDone reports the reconciled session id', async () => {
    const realId = '019f9858-1fa6-7550-b514-7de5300c3a0b'
    const adapter = fakeAdapter({
      onSend: async function* () {
        yield { type: 'session-started', sessionId: realId } satisfies AgentEvent
        yield { type: 'turn-completed' } satisfies AgentEvent
      },
    })
    const { mgr } = await makeManager(adapter)
    const created = await mgr.createSession()

    const handle = await mgr.send(created.sessionId, 'hello')
    const doneSessionId = await new Promise<string>((r) => handle.onDone((sid) => r(sid)))

    expect(doneSessionId).toBe(realId)
  })

  it('marks a session running for the duration of a turn and broadcasts both edges', async () => {
    // Definite assignment: the Promise executor runs synchronously, so `release`
    // is always set before the test body calls it.
    let release!: () => void
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

    const handle = await mgr.send('sid-1', 'hello')
    expect(mgr.isRunning('sid-1')).toBe(true)
    expect(events).toEqual([{ sessionId: 'sid-1', running: true }])
    expect((await mgr.listSessions()).find((s) => s.id === 'sid-1')?.running).toBe(true)

    const done = new Promise<void>((r) => handle.onDone(() => r()))
    release()
    await done

    expect(mgr.isRunning('sid-1')).toBe(false)
    expect(events).toEqual([
      { sessionId: 'sid-1', running: true },
      { sessionId: 'sid-1', running: false },
    ])
    expect((await mgr.listSessions()).find((s) => s.id === 'sid-1')?.running).toBe(false)
  })

  it('calls onSessionStatusChange for running status edges', async () => {
    const adapter = fakeAdapter({})
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-sm-'))
    const store = new SessionStore(cwd)
    const callbacks: Array<{ sessionId: string; running: boolean }> = []
    const mgr = new SessionManager(cwd, 'claude', store, {
      onSessionStatusChange: (ev) => {
        callbacks.push(ev)
      },
    })
    ;(mgr as unknown as { adapters: { get: () => AgentSdkAdapter } }).adapters = {
      get: () => adapter,
    }
    await store.upsert(info({ id: 'sid-1', createdAt: 5, updatedAt: 9 }))

    const handle = await mgr.send('sid-1', 'hello')
    await new Promise<void>((r) => handle.onDone(() => r()))

    expect(callbacks).toEqual([
      { sessionId: 'sid-1', running: true },
      { sessionId: 'sid-1', running: false },
    ])
  })
})

describe('SessionManager.dispose', () => {
  it('aborts live sessions and waits for their active dispatches', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let aborted = false
    const adapter = fakeAdapter({
      onSend: async function* () {
        markStarted()
        await gate
        yield { type: 'turn-completed' } satisfies AgentEvent
      },
      onAbort: () => {
        aborted = true
        release()
      },
    })
    const { mgr, store } = await makeManager(adapter)
    await store.upsert(info({ id: 'sid-dispose', createdAt: 5, updatedAt: 9 }))
    const handle = await mgr.send('sid-dispose', 'hello')
    await started
    let doneResolved = false
    const done = new Promise<void>((resolve) => {
      handle.onDone(() => {
        doneResolved = true
        resolve()
      })
    })

    try {
      await mgr.dispose()
      expect(aborted).toBe(true)
      expect(doneResolved).toBe(true)
      expect(mgr.isRunning('sid-dispose')).toBe(false)
    } finally {
      // 旧实现不会 abort；测试失败时也要释放生成器，避免遗留异步任务。
      release()
      await done
    }
  })
})
