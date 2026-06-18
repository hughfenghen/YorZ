import { createRoot } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import {
  cancelRun,
  fetchActiveRuns,
  subscribeRun,
  type ActiveRunInfo,
  type AgentMode,
} from './sse.js'

export type AgentTaskStatus = 'pending' | 'streaming' | 'done' | 'failed'
export type AgentTaskSource = 'run' | 'explain' | 'draft'

export interface AgentTask {
  runId: string
  mode: AgentMode
  specId: string
  specTitle?: string
  source: AgentTaskSource
  status: AgentTaskStatus
  output: string
  error?: string
  startedAt: number
  endedAt?: number
  expanded: boolean
  dismissed: boolean
}

export interface AgentTaskInput {
  runId: string
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
  unsubByRun: Map<string, () => void>
}

function createAgentTasks() {
  const [state, setState] = createStore<AgentTasksState>({ tasks: {}, order: [] })
  const internal: Internal = {
    unsubByRun: new Map(),
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

    const task: AgentTask = {
      runId: input.runId,
      mode: input.mode,
      specId: input.specId,
      specTitle: input.specTitle,
      source: input.source,
      status: 'pending',
      output: '',
      startedAt: input.startedAt ?? Date.now(),
      expanded: true,
      dismissed: false,
    }

    setState(
      produce((s) => {
        s.tasks[task.runId] = task
        s.order.push(task.runId)
      }),
    )

    const unsub = subscribeRun(input.runId, {
      onAgentStdout: (e) => {
        setState(
          produce((s) => {
            const t = s.tasks[input.runId]
            if (!t) return
            t.output += e.chunk
            if (t.status === 'pending') t.status = 'streaming'
          }),
        )
      },
      onAgentExit: (e) => {
        setState(
          produce((s) => {
            const t = s.tasks[input.runId]
            if (!t) return
            t.status = e.code === 0 ? 'done' : 'failed'
            t.endedAt = Date.now()
          }),
        )
        const u = internal.unsubByRun.get(input.runId)
        if (u) {
          u()
          internal.unsubByRun.delete(input.runId)
        }
      },
      onAgentError: (e) => {
        setState(
          produce((s) => {
            const t = s.tasks[input.runId]
            if (!t) return
            t.error = e.message
            t.status = 'failed'
            t.endedAt = Date.now()
          }),
        )
        const u = internal.unsubByRun.get(input.runId)
        if (u) {
          u()
          internal.unsubByRun.delete(input.runId)
        }
      },
    })
    internal.unsubByRun.set(input.runId, unsub)
  }

  function dismiss(runId: string) {
    const t = state.tasks[runId]
    if (t && (t.status === 'pending' || t.status === 'streaming')) {
      void cancelRun(runId)
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

  async function hydrateFromActiveRuns(): Promise<void> {
    let list: ActiveRunInfo[] = []
    try {
      list = await fetchActiveRuns()
    } catch {
      return
    }
    for (const item of list) {
      // Source is unknown when hydrating; pick a sensible default per mode.
      const source: AgentTaskSource = item.mode === 'explain' ? 'explain' : 'run'
      start({
        runId: item.runId,
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
  }
}

export type AgentTasks = ReturnType<typeof createAgentTasks>

export const agentTasks: AgentTasks = createRoot(() => createAgentTasks())
