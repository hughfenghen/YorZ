import { createRoot } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import {
  cancelRun,
  fetchActiveRuns,
  subscribeRun,
  type ActiveRunInfo,
  type AgentMode,
  type SseSubscription,
} from './sse.js'

export type AgentTaskStatus = 'pending' | 'streaming' | 'done' | 'failed'
export type AgentTaskSource = 'run' | 'explain' | 'draft'

// If an active task receives no SSE traffic (stdout / server-heartbeat / exit /
// error) for this long AND its EventSource is no longer OPEN, the watchdog
// marks it failed with reason "Server 失联".
export const STALE_AFTER_MS = 20_000
export const WATCHDOG_TICK_MS = 2_000
const EVENT_SOURCE_OPEN = 1

export interface AgentTask {
  runId: string
  projectId: string
  mode: AgentMode
  specId: string
  specTitle?: string
  source: AgentTaskSource
  status: AgentTaskStatus
  output: string
  error?: string
  startedAt: number
  endedAt?: number
  lastEventAt: number
  expanded: boolean
  dismissed: boolean
}

export interface AgentTaskInput {
  runId: string
  projectId: string
  mode: AgentMode
  specId: string
  specTitle?: string
  source: AgentTaskSource
  startedAt?: number
}

interface AgentTasksState {
  tasks: Record<string, AgentTask>
  order: string[]
}

interface Internal {
  unsubByRun: Map<string, SseSubscription>
  watchdogTimer: ReturnType<typeof setInterval> | null
}

export function createAgentTasks() {
  const [state, setState] = createStore<AgentTasksState>({ tasks: {}, order: [] })
  const internal: Internal = {
    unsubByRun: new Map(),
    watchdogTimer: null,
  }

  function touch(runId: string): void {
    setState(
      produce((s) => {
        const t = s.tasks[runId]
        if (t) t.lastEventAt = Date.now()
      }),
    )
  }

  function hasActiveTasks(): boolean {
    for (const id of state.order) {
      const t = state.tasks[id]
      if (!t) continue
      if (t.dismissed) continue
      if (t.status === 'pending' || t.status === 'streaming') return true
    }
    return false
  }

  function tickWatchdog(): void {
    const now = Date.now()
    for (const id of state.order) {
      const t = state.tasks[id]
      if (!t) continue
      if (t.status !== 'pending' && t.status !== 'streaming') continue
      if (now - t.lastEventAt <= STALE_AFTER_MS) continue
      const sub = internal.unsubByRun.get(id)
      if (sub && sub.readyState() === EVENT_SOURCE_OPEN) continue
      setState(
        produce((s) => {
          const x = s.tasks[id]
          if (!x) return
          x.status = 'failed'
          x.error = 'Server 失联，任务可能已终止'
          x.endedAt = Date.now()
        }),
      )
      const u = internal.unsubByRun.get(id)
      if (u) {
        u()
        internal.unsubByRun.delete(id)
      }
    }
    if (!hasActiveTasks()) stopWatchdog()
  }

  function ensureWatchdog(): void {
    if (internal.watchdogTimer != null) return
    internal.watchdogTimer = setInterval(tickWatchdog, WATCHDOG_TICK_MS)
  }

  function stopWatchdog(): void {
    if (internal.watchdogTimer == null) return
    clearInterval(internal.watchdogTimer)
    internal.watchdogTimer = null
  }

  function start(input: AgentTaskInput): void {
    const existing = state.tasks[input.runId]
    if (existing) {
      // Already tracked. Allow re-surfacing if dismissed and refresh metadata
      // — this is how the draft→real specId handoff works: NewSpec registered
      // the task under a placeholder specId; SpecDetail re-calls start() with
      // the real one once it picks up ?runId=.
      setState(
        produce((s) => {
          const t = s.tasks[input.runId]
          if (!t) return
          if (t.dismissed) t.dismissed = false
          if (!input.specId.startsWith('__draft__')) t.specId = input.specId
          if (input.specTitle) t.specTitle = input.specTitle
        }),
      )
      return
    }

    const startedAt = input.startedAt ?? Date.now()
    const task: AgentTask = {
      runId: input.runId,
      projectId: input.projectId,
      mode: input.mode,
      specId: input.specId,
      specTitle: input.specTitle,
      source: input.source,
      status: 'pending',
      output: '',
      startedAt,
      lastEventAt: Date.now(),
      expanded: true,
      dismissed: false,
    }

    setState(
      produce((s) => {
        s.tasks[task.runId] = task
        s.order.push(task.runId)
      }),
    )

    const unsub = subscribeRun(input.projectId, input.runId, {
      onAgentStdout: (e) => {
        setState(
          produce((s) => {
            const t = s.tasks[input.runId]
            if (!t) return
            t.output += e.chunk
            t.lastEventAt = Date.now()
            if (t.status === 'pending') t.status = 'streaming'
          }),
        )
      },
      onServerHeartbeat: () => {
        touch(input.runId)
      },
      onAgentExit: (e) => {
        setState(
          produce((s) => {
            const t = s.tasks[input.runId]
            if (!t) return
            t.status = e.code === 0 ? 'done' : 'failed'
            t.endedAt = Date.now()
            t.lastEventAt = Date.now()
          }),
        )
        const u = internal.unsubByRun.get(input.runId)
        if (u) {
          u()
          internal.unsubByRun.delete(input.runId)
        }
        if (!hasActiveTasks()) stopWatchdog()
      },
      onAgentError: (e) => {
        setState(
          produce((s) => {
            const t = s.tasks[input.runId]
            if (!t) return
            t.error = e.message
            t.status = 'failed'
            t.endedAt = Date.now()
            t.lastEventAt = Date.now()
          }),
        )
        const u = internal.unsubByRun.get(input.runId)
        if (u) {
          u()
          internal.unsubByRun.delete(input.runId)
        }
        if (!hasActiveTasks()) stopWatchdog()
      },
    })
    internal.unsubByRun.set(input.runId, unsub)
    ensureWatchdog()
  }

  function reconcileWithActive(activeIds: Set<string>): void {
    for (const id of state.order) {
      const t = state.tasks[id]
      if (!t) continue
      if (t.status !== 'pending' && t.status !== 'streaming') continue
      if (activeIds.has(id)) continue
      setState(
        produce((s) => {
          const x = s.tasks[id]
          if (!x) return
          x.status = 'failed'
          x.error = 'Server 已重启，原任务未恢复'
          x.endedAt = Date.now()
          x.lastEventAt = Date.now()
        }),
      )
      const u = internal.unsubByRun.get(id)
      if (u) {
        u()
        internal.unsubByRun.delete(id)
      }
    }
    if (!hasActiveTasks()) stopWatchdog()
  }

  function dismiss(runId: string) {
    const t = state.tasks[runId]
    if (t && (t.status === 'pending' || t.status === 'streaming')) {
      void cancelRun(t.projectId, runId)
    }
    setState(
      produce((s) => {
        const task = s.tasks[runId]
        if (task) task.dismissed = true
      }),
    )
  }

  function toggleExpand(runId: string) {
    setState(
      produce((s) => {
        const t = s.tasks[runId]
        if (t) t.expanded = !t.expanded
      }),
    )
  }

  function clearFinished() {
    setState(
      produce((s) => {
        s.order = s.order.filter((id) => {
          const t = s.tasks[id]
          if (!t) return false
          if (t.status === 'done' || t.status === 'failed') {
            delete s.tasks[id]
            return false
          }
          return true
        })
      }),
    )
  }

  function hasRunningSkillRun(specId: string): boolean {
    for (const id of state.order) {
      const t = state.tasks[id]
      if (!t) continue
      if (t.mode !== 'skill-run') continue
      if (t.specId !== specId) continue
      if (t.status === 'pending' || t.status === 'streaming') return true
    }
    return false
  }

  async function hydrateFromActiveRuns(pid: string): Promise<void> {
    if (!pid) return
    let list: ActiveRunInfo[] = []
    try {
      list = await fetchActiveRuns(pid)
    } catch {
      return
    }
    reconcileWithActive(new Set(list.map((i) => i.runId)))
    for (const item of list) {
      // Source is unknown when hydrating; pick a sensible default per mode.
      const source: AgentTaskSource = item.mode === 'explain' ? 'explain' : 'run'
      start({
        runId: item.runId,
        projectId: pid,
        mode: item.mode,
        specId: item.specId,
        source,
        startedAt: item.startedAt,
      })
    }
  }

  return {
    state,
    start,
    dismiss,
    toggleExpand,
    clearFinished,
    hasRunningSkillRun,
    hydrateFromActiveRuns,
    reconcileWithActive,
  }
}

export type AgentTasks = ReturnType<typeof createAgentTasks>

export const agentTasks: AgentTasks = createRoot(() => createAgentTasks())
