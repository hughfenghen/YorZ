import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { AdapterRegistry } from './agent-sdk/registry.js'
import type {
  AgentEvent,
  AgentKind,
  AgentSession,
  NormalizedMessage,
  SessionInfo,
} from './agent-sdk/types.js'
import { SessionStore } from './session-store.js'

export interface SessionRunHandle {
  runId: string
  sessionId: string
  onEvent(cb: (ev: AgentEvent) => void): () => void
  onDone(cb: () => void): () => void
}

/** Broadcast when a session starts / finishes a turn (project-level SSE topic). */
export interface SessionStatusEvent {
  sessionId: string
  running: boolean
}

interface LiveSession {
  kind: AgentKind
  session: AgentSession
}

/** Cap the merged session list — adapters can enumerate hundreds of transcripts. */
export const SESSION_LIST_LIMIT = 30

/**
 * Per-project owner of agent sessions. Bridges the streaming AgentEvent model
 * of each adapter into the runId + emitter pattern the EventsHub subscribes to,
 * and keeps the SessionStore index in sync.
 */
export class SessionManager {
  private readonly adapters: AdapterRegistry
  private readonly live = new Map<string, LiveSession>()
  private readonly emitters = new Map<string, EventEmitter>()
  /** Session ids with an in-flight turn. Drives the list spinner. */
  private readonly running = new Set<string>()
  private readonly statusEmitter = new EventEmitter()

  constructor(
    private readonly cwd: string,
    private readonly defaultKind: AgentKind,
    private readonly store: SessionStore,
  ) {
    this.adapters = new AdapterRegistry(cwd)
    this.statusEmitter.setMaxListeners(0)
  }

  private emitterFor(sid: string): EventEmitter {
    let e = this.emitters.get(sid)
    if (!e) {
      e = new EventEmitter()
      e.setMaxListeners(0)
      this.emitters.set(sid, e)
    }
    return e
  }

  async createSession(
    kind?: AgentKind,
    title?: string,
    specId?: string,
  ): Promise<{ sessionId: string; kind: AgentKind }> {
    const k = kind ?? this.defaultKind
    const adapter = this.adapters.get(k)
    const session = await adapter.createSession(title ? { title } : undefined)
    // Codex has no id until the first turn: assign a provisional id and
    // reconcile once `session-started` surfaces the real thread id.
    const sessionId = session.id || randomUUID()
    this.live.set(sessionId, { kind: k, session })
    await this.store.create(k, sessionId, title ?? sessionId, specId)
    return { sessionId, kind: k }
  }

  /**
   * Look up the dedicated session for a spec WITHOUT creating one. Used by the
   * read-only `GET /specs/:id/session` probe: merely opening a spec detail page
   * must not mint a session that never runs a turn (those would show up in the
   * list as "ghost" entries with permanently empty history).
   */
  async findSessionForSpec(specId: string): Promise<{ sessionId: string; kind: AgentKind } | null> {
    const existing = await this.store.getBySpec(specId)
    if (!existing) return null
    return { sessionId: existing.id, kind: existing.kind }
  }

  /**
   * Get (or lazily create) the dedicated session for a spec. All system-driven
   * rounds (run / explain / review / git-ops) reuse this per-spec session so
   * their output lands in one conversation the Chat panel can switch to.
   * Only call this when a turn is actually about to be sent.
   */
  async ensureSessionForSpec(specId: string): Promise<{ sessionId: string; kind: AgentKind }> {
    const existing = await this.findSessionForSpec(specId)
    if (existing) return existing
    return this.createSession(undefined, specId, specId)
  }

  async listSessions(): Promise<SessionInfo[]> {
    const indexed = await this.store.list()
    const byId = new Map<string, SessionInfo>(indexed.map((s) => [s.id, s]))
    const nativeIds = new Set<string>()
    // Merge SDK-native session listing (kinds that support it) for discovery.
    for (const kind of ['claude', 'codex', 'opencode'] as AgentKind[]) {
      const adapter = this.adapters.get(kind)
      if (!adapter.capabilities().listSessions) continue
      try {
        for (const info of await adapter.listSessions()) {
          nativeIds.add(info.id)
          if (!byId.has(info.id)) byId.set(info.id, info)
        }
      } catch {
        // adapter unavailable (e.g. not authenticated); skip
      }
    }

    // Drop "ghost" sessions: indexed entries that never ran a turn (createdAt
    // === updatedAt, since touch() only fires in send()'s finally) AND have no
    // transcript on the adapter side. Those can never yield history.
    const alive = [...byId.values()].filter(
      (s) => nativeIds.has(s.id) || s.createdAt !== s.updatedAt || this.running.has(s.id),
    )

    const out: SessionInfo[] = []
    for (const s of alive.sort((a, b) => b.updatedAt - a.updatedAt)) {
      out.push({ ...s, running: this.running.has(s.id) })
      if (out.length >= SESSION_LIST_LIMIT) break
    }
    return out
  }

  /** Whether a turn is currently in flight for this session. */
  isRunning(sid: string): boolean {
    return this.running.has(sid)
  }

  /** Subscribe to project-level session run status changes. */
  subscribeStatus(cb: (ev: SessionStatusEvent) => void): () => void {
    this.statusEmitter.on('status', cb)
    return () => this.statusEmitter.off('status', cb)
  }

  private setRunning(sid: string, running: boolean): void {
    if (running) this.running.add(sid)
    else this.running.delete(sid)
    this.statusEmitter.emit('status', { sessionId: sid, running } satisfies SessionStatusEvent)
  }

  async getMessages(sid: string): Promise<NormalizedMessage[]> {
    const kind = (await this.store.get(sid))?.kind ?? this.live.get(sid)?.kind ?? this.defaultKind
    const adapter = this.adapters.get(kind)
    if (!adapter.capabilities().getMessages) return []
    return adapter.getMessages(sid)
  }

  private async ensureLive(sid: string): Promise<LiveSession> {
    const existing = this.live.get(sid)
    if (existing) return existing
    const kind = (await this.store.get(sid))?.kind ?? this.defaultKind
    const adapter = this.adapters.get(kind)
    const session = await adapter.resumeSession(sid)
    const ls: LiveSession = { kind, session }
    this.live.set(sid, ls)
    return ls
  }

  send(sid: string, prompt: string): SessionRunHandle {
    const runId = randomUUID()
    const emitter = this.emitterFor(sid)
    // `sid` may be rewritten mid-run by reconcile() (codex assigns the real
    // thread id on `session-started`); track the live id for status bookkeeping.
    let currentSid = sid
    this.setRunning(sid, true)
    void (async () => {
      try {
        const ls = await this.ensureLive(sid)
        for await (const ev of ls.session.send(prompt)) {
          if (ev.type === 'session-started' && ev.sessionId !== currentSid) {
            const oldSid = currentSid
            currentSid = ev.sessionId
            await this.reconcile(oldSid, ev.sessionId)
          }
          emitter.emit('event', ev)
        }
      } catch (err) {
        emitter.emit('event', {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        } satisfies AgentEvent)
      } finally {
        await this.store.touch(currentSid).catch(() => {})
        this.setRunning(currentSid, false)
        emitter.emit('done')
      }
    })()
    return {
      runId,
      sessionId: sid,
      onEvent: (cb) => {
        emitter.on('event', cb)
        return () => emitter.off('event', cb)
      },
      onDone: (cb) => {
        emitter.once('done', cb)
        return () => emitter.off('done', cb)
      },
    }
  }

  /** Subscribe to all events for a session id, independent of active runs. */
  subscribe(sid: string, onEvent: (ev: AgentEvent) => void): () => void {
    const emitter = this.emitterFor(sid)
    emitter.on('event', onEvent)
    return () => emitter.off('event', onEvent)
  }

  private async reconcile(oldId: string, newId: string): Promise<void> {
    const ls = this.live.get(oldId)
    if (ls) {
      this.live.delete(oldId)
      this.live.set(newId, ls)
    }
    const em = this.emitters.get(oldId)
    if (em) this.emitters.set(newId, em)
    if (this.running.has(oldId)) {
      this.setRunning(oldId, false)
      this.setRunning(newId, true)
    }
    await this.store.reconcileId(oldId, newId).catch(() => {})
  }

  async abort(sid: string): Promise<boolean> {
    const ls = this.live.get(sid)
    if (!ls) return false
    ls.session.abort()
    return true
  }

  async dispose(): Promise<void> {
    await this.adapters.dispose()
    this.live.clear()
    this.emitters.clear()
  }
}
