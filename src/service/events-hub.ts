import type { SSEStreamingApi } from 'hono/streaming'
import type { AgentRunHandle } from './agent.js'
import { listChanges } from './git.js'
import type { ProjectInstance, ProjectRegistry } from './project-registry.js'
import type { RegistryEventBus } from './registry-events.js'

export type ResolveProject = (id: string) => Promise<ProjectInstance | null>

export const HEARTBEAT_INTERVAL_MS = 5000

// Periodically writes a `: keep-alive` SSE comment (for reverse-proxy idle
// timeouts) plus a `server-heartbeat` named event (for the GUI watchdog to
// refresh its lastEventAt). Returns a cleanup function that clears the timer.
export function attachHeartbeat(
  stream: SSEStreamingApi,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        await stream.write(': keep-alive\n\n')
        await stream.writeSSE({
          event: 'server-heartbeat',
          data: JSON.stringify({ ts: Date.now() }),
        })
      } catch {
        // stream may have closed between writes; caller handles teardown
      }
    })()
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

interface SseFrame {
  event: string
  data: string
}

interface Session {
  id: string
  stream: SSEStreamingApi | null
  topics: Map<string, () => void>
  queue: SseFrame[]
  closed: boolean
  syncQueue: Promise<void>
  stopHeartbeat: (() => void) | null
}

// Shared per-project git-changes watcher (collapses N tabs into a single 1s
// poll — keeps macOS syspolicyd from being pinned by fork storms).
interface ChangesWatcher {
  subscribers: Set<(changes: unknown) => void>
  timer: ReturnType<typeof setInterval> | null
  lastSig: string
  lastChanges: unknown
  polling: boolean
}
const changesWatchers = new Map<string, ChangesWatcher>()

function subscribeGitChanges(
  path: string,
  onChanges: (changes: unknown) => void,
): { current: unknown; unsubscribe: () => void } {
  let w = changesWatchers.get(path)
  if (!w) {
    w = { subscribers: new Set(), timer: null, lastSig: '', lastChanges: [], polling: false }
    changesWatchers.set(path, w)
  }
  const watcher = w
  watcher.subscribers.add(onChanges)

  const poll = async () => {
    if (watcher.polling) return
    watcher.polling = true
    try {
      const changes = await listChanges(path)
      const sig = JSON.stringify(changes)
      if (sig !== watcher.lastSig) {
        watcher.lastSig = sig
        watcher.lastChanges = changes
        for (const cb of watcher.subscribers) {
          try {
            cb(changes)
          } catch {
            // subscriber errors must not break the poll loop
          }
        }
      }
    } catch {
      // git errors are transient; keep polling
    } finally {
      watcher.polling = false
    }
  }

  if (!watcher.timer) {
    watcher.timer = setInterval(() => void poll(), 1000)
    watcher.timer.unref?.()
    void poll()
  }

  return {
    current: watcher.lastChanges,
    unsubscribe: () => {
      watcher.subscribers.delete(onChanges)
      if (watcher.subscribers.size === 0) {
        if (watcher.timer) clearInterval(watcher.timer)
        changesWatchers.delete(path)
      }
    },
  }
}

export interface HubDeps {
  resolveProject: ResolveProject
  registry?: ProjectRegistry
  projectsBus?: RegistryEventBus
}

export class EventsHub {
  private sessions = new Map<string, Session>()
  constructor(private deps: HubDeps) {}

  private getOrCreate(id: string): Session {
    let s = this.sessions.get(id)
    if (!s) {
      s = {
        id,
        stream: null,
        topics: new Map(),
        queue: [],
        closed: false,
        syncQueue: Promise.resolve(),
        stopHeartbeat: null,
      }
      this.sessions.set(id, s)
    }
    return s
  }

  /** Attach the SSE stream for a session and start heartbeats. Flushes any queued frames. */
  attachStream(id: string, stream: SSEStreamingApi): void {
    const s = this.getOrCreate(id)
    // If a previous stream is still around (e.g. rapid reconnect before close
    // handler fired), drop it — the new one owns the session.
    s.stopHeartbeat?.()
    s.stream = stream
    s.closed = false
    void this.flush(s)
    s.stopHeartbeat = attachHeartbeat(stream)
  }

  /** Tear down a session: unsubscribe all topics, drop buffered frames, delete. */
  detach(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.closed = true
    s.stopHeartbeat?.()
    s.stopHeartbeat = null
    s.stream = null
    for (const unsub of s.topics.values()) {
      try {
        unsub()
      } catch {
        // best-effort cleanup
      }
    }
    s.topics.clear()
    s.queue.length = 0
    this.sessions.delete(id)
  }

  /** Replace the topic set for a session. Emits initial-state events for new topics. */
  async syncTopics(
    id: string,
    wanted: string[],
  ): Promise<{ subscribed: string[]; errors: Record<string, string> }> {
    const s = this.getOrCreate(id)
    // Serialise concurrent syncs on the same session.
    const run = async () => {
      const wantedSet = new Set(wanted)
      const errors: Record<string, string> = {}

      for (const t of [...s.topics.keys()]) {
        if (!wantedSet.has(t)) {
          try {
            s.topics.get(t)!()
          } catch {
            // ignore
          }
          s.topics.delete(t)
        }
      }
      for (const t of wantedSet) {
        if (s.topics.has(t)) continue
        try {
          const unsub = await this.attachTopic(s, t)
          if (s.closed) {
            unsub()
            return
          }
          s.topics.set(t, unsub)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          errors[t] = msg
          this.emit(s, t, 'error', { error: msg })
        }
      }
      return { subscribed: [...s.topics.keys()], errors }
    }
    const next = s.syncQueue.then(run)
    s.syncQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return (await next) as { subscribed: string[]; errors: Record<string, string> }
  }

  private emit(s: Session, topic: string, event: string, data: unknown): void {
    const frame: SseFrame = {
      event: 'msg',
      data: JSON.stringify({ topic, event, data }),
    }
    if (s.stream && !s.closed) {
      void s.stream.writeSSE(frame).catch(() => {})
    } else {
      s.queue.push(frame)
    }
  }

  private async flush(s: Session): Promise<void> {
    while (s.stream && !s.closed && s.queue.length > 0) {
      const frame = s.queue.shift()!
      try {
        await s.stream.writeSSE(frame)
      } catch {
        // stream died; stop flushing
        return
      }
    }
  }

  private async attachTopic(s: Session, topic: string): Promise<() => void> {
    if (topic === 'projects') return this.attachProjects(s)
    const m = /^project:([^:]+):(.+)$/.exec(topic)
    if (!m) throw new Error(`invalid topic: ${topic}`)
    const pid = m[1]
    const rest = m[2]
    const project = await this.deps.resolveProject(pid)
    if (!project) throw new Error('project not found')

    if (rest === 'specs') return this.attachSpecsList(s, topic, project)
    let sm = /^spec:([^:]+):changes$/.exec(rest)
    if (sm) return this.attachSpecChanges(s, topic, project, sm[1])
    sm = /^spec:([^:]+)$/.exec(rest)
    if (sm) return this.attachSpec(s, topic, project, sm[1])
    sm = /^run:(.+)$/.exec(rest)
    if (sm) return this.attachRun(s, topic, project, sm[1])
    throw new Error(`invalid topic: ${topic}`)
  }

  private attachProjects(s: Session): () => void {
    this.emit(s, 'projects', 'ready', {})
    const bus = this.deps.projectsBus
    if (!bus) return () => {}
    return bus.subscribe(() => {
      this.emit(s, 'projects', 'projects-changed', {})
    })
  }

  private attachSpecsList(s: Session, topic: string, project: ProjectInstance): () => void {
    this.emit(s, topic, 'ready', {})
    return project.watcher.subscribeList(() => {
      this.emit(s, topic, 'list-updated', {})
    })
  }

  private async attachSpec(
    s: Session,
    topic: string,
    project: ProjectInstance,
    specId: string,
  ): Promise<() => void> {
    const exists = await project.store.read(specId)
    if (!exists) throw new Error('spec not found')
    this.emit(s, topic, 'ready', { id: specId, mtime: exists.mtime })

    const unsubFile = project.watcher.subscribe(specId, (kind, mtime) => {
      this.emit(s, topic, 'updated', { type: kind, mtime })
    })

    const agentUnsubs: Array<() => void> = []
    const attachAgent = (handle: AgentRunHandle) => {
      const buf = handle.buffer()
      if (buf) {
        this.emit(s, topic, 'agent-stdout', {
          runId: handle.id,
          mode: handle.mode,
          specId: handle.specId,
          chunk: buf,
        })
      }
      agentUnsubs.push(
        handle.onStdout((chunk) => {
          this.emit(s, topic, 'agent-stdout', {
            runId: handle.id,
            mode: handle.mode,
            specId: handle.specId,
            chunk,
          })
        }),
        handle.onError((message) => {
          this.emit(s, topic, 'agent-error', {
            runId: handle.id,
            mode: handle.mode,
            specId: handle.specId,
            message,
          })
        }),
        handle.onExit((code) => {
          this.emit(s, topic, 'agent-exit', {
            runId: handle.id,
            mode: handle.mode,
            specId: handle.specId,
            code,
          })
        }),
      )
    }
    for (const h of project.runner.active(specId)) attachAgent(h)
    const unsubAgent = project.runner.subscribe(specId, attachAgent)

    return () => {
      unsubFile()
      unsubAgent()
      for (const u of agentUnsubs) u()
    }
  }

  private async attachSpecChanges(
    s: Session,
    topic: string,
    project: ProjectInstance,
    specId: string,
  ): Promise<() => void> {
    const exists = await project.store.read(specId)
    if (!exists) throw new Error('spec not found')
    this.emit(s, topic, 'ready', {})
    const { current, unsubscribe } = subscribeGitChanges(project.path, (changes) => {
      this.emit(s, topic, 'changes-updated', { changes })
    })
    if (Array.isArray(current) ? current.length > 0 : current) {
      this.emit(s, topic, 'changes-updated', { changes: current })
    }
    return unsubscribe
  }

  private attachRun(
    s: Session,
    topic: string,
    project: ProjectInstance,
    runId: string,
  ): () => void {
    const handle = project.runner.get(runId)
    if (!handle) throw new Error('run not found or already ended')
    this.emit(s, topic, 'ready', { runId, mode: handle.mode, specId: handle.specId })
    const buf = handle.buffer()
    if (buf) {
      this.emit(s, topic, 'agent-stdout', {
        runId,
        mode: handle.mode,
        specId: handle.specId,
        chunk: buf,
      })
    }
    const u1 = handle.onStdout((chunk) => {
      this.emit(s, topic, 'agent-stdout', { runId, mode: handle.mode, specId: handle.specId, chunk })
    })
    const u2 = handle.onError((message) => {
      this.emit(s, topic, 'agent-error', {
        runId,
        mode: handle.mode,
        specId: handle.specId,
        message,
      })
    })
    const u3 = handle.onExit((code) => {
      this.emit(s, topic, 'agent-exit', { runId, mode: handle.mode, specId: handle.specId, code })
    })
    return () => {
      u1()
      u2()
      u3()
    }
  }
}
