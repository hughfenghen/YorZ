import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { AdapterRegistry } from './agent-sdk/registry.js'
import type { AgentEvent, AgentKind, AgentSession, NormalizedMessage } from './agent-sdk/types.js'
import { SessionStore } from './session-store.js'

export interface SessionRunHandle {
  runId: string
  sessionId: string
  onEvent(cb: (ev: AgentEvent) => void): () => void
  onDone(cb: () => void): () => void
}

interface LiveSession {
  kind: AgentKind
  session: AgentSession
}

/**
 * Per-project owner of agent sessions. Bridges the streaming AgentEvent model
 * of each adapter into the runId + emitter pattern the EventsHub subscribes to,
 * and keeps the SessionStore index in sync.
 */
export class SessionManager {
  private readonly adapters: AdapterRegistry
  private readonly live = new Map<string, LiveSession>()
  private readonly emitters = new Map<string, EventEmitter>()

  constructor(
    private readonly cwd: string,
    private readonly defaultKind: AgentKind,
    private readonly store: SessionStore,
  ) {
    this.adapters = new AdapterRegistry(cwd)
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
   * Get (or lazily create) the dedicated session for a spec. All system-driven
   * rounds (run / explain / review / git-ops) reuse this per-spec session so
   * their output lands in one conversation the Chat panel can switch to.
   */
  async sessionForSpec(specId: string): Promise<{ sessionId: string; kind: AgentKind }> {
    const existing = await this.store.getBySpec(specId)
    if (existing) return { sessionId: existing.id, kind: existing.kind }
    return this.createSession(undefined, specId, specId)
  }

  async listSessions(): Promise<
    Array<{ id: string; title: string; kind: AgentKind; createdAt: number; updatedAt: number }>
  > {
    const indexed = await this.store.list()
    const byId = new Map(indexed.map((s) => [s.id, s]))
    // Merge SDK-native session listing (kinds that support it) for discovery.
    for (const kind of ['claude', 'codex', 'opencode'] as AgentKind[]) {
      const adapter = this.adapters.get(kind)
      if (!adapter.capabilities().listSessions) continue
      try {
        for (const info of await adapter.listSessions()) {
          if (!byId.has(info.id)) byId.set(info.id, info)
        }
      } catch {
        // adapter unavailable (e.g. not authenticated); skip
      }
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)
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
    void (async () => {
      try {
        const ls = await this.ensureLive(sid)
        for await (const ev of ls.session.send(prompt)) {
          if (ev.type === 'session-started' && ev.sessionId !== sid) {
            await this.reconcile(sid, ev.sessionId)
          }
          emitter.emit('event', ev)
        }
      } catch (err) {
        emitter.emit('event', {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        } satisfies AgentEvent)
      } finally {
        await this.store.touch(sid).catch(() => {})
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
