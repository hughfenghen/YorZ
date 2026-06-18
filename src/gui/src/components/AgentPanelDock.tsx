import { A } from '@solidjs/router'
import { For, Show, createMemo, createSignal, onCleanup, type Component } from 'solid-js'
import { agentTasks, type AgentTask } from '../lib/agent-tasks.js'

const SOURCE_LABEL: Record<AgentTask['source'], string> = {
  run: '执行 spec',
  explain: '解释',
  draft: '新建 spec',
}

const STATUS_LABEL: Record<AgentTask['status'], string> = {
  pending: '等待…',
  streaming: '运行中',
  done: '已完成',
  failed: '失败',
}

const COLLAPSE_THRESHOLD = 3

export const AgentPanelDock: Component = () => {
  const [collapsed, setCollapsed] = createSignal(false)

  const visibleTasks = createMemo<AgentTask[]>(() =>
    agentTasks.state.order
      .map((id) => agentTasks.state.tasks[id])
      .filter((t): t is AgentTask => !!t && !t.dismissed),
  )

  const hasFinished = createMemo(() =>
    visibleTasks().some((t) => t.status === 'done' || t.status === 'failed'),
  )

  // When list grows large, auto-collapse the dock once on next mount; user can re-expand.
  createMemo(() => {
    if (visibleTasks().length > COLLAPSE_THRESHOLD && !collapsed()) setCollapsed(true)
  })

  return (
    <Show when={visibleTasks().length > 0}>
      <aside class="agent-dock" aria-label="Agent 任务面板">
        <header class="agent-dock-head">
          <button
            type="button"
            class="agent-dock-toggle"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed()}
          >
            <span class="agent-dock-title">Agent 任务</span>
            <span class="agent-dock-badge">{visibleTasks().length}</span>
            <span class="agent-dock-chevron">{collapsed() ? '▲' : '▼'}</span>
          </button>
          <Show when={hasFinished()}>
            <button
              type="button"
              class="agent-dock-clear"
              onClick={() => agentTasks.clearFinished()}
            >
              清理已完成
            </button>
          </Show>
        </header>
        <Show when={!collapsed()}>
          <ul class="agent-dock-list">
            <For each={visibleTasks()}>{(task) => <AgentTaskCard task={task} />}</For>
          </ul>
        </Show>
      </aside>
    </Show>
  )
}

const AgentTaskCard: Component<{ task: AgentTask }> = (props) => {
  const isDraft = () => props.task.specId.startsWith('__draft__')
  const [tick, setTick] = createSignal(0)

  // Tick once per second while the task is active, to refresh the timer display.
  const interval = setInterval(() => {
    if (props.task.status === 'pending' || props.task.status === 'streaming') {
      setTick((t) => t + 1)
    }
  }, 1000)
  onCleanup(() => clearInterval(interval))

  const elapsed = createMemo(() => {
    void tick()
    const end = props.task.endedAt ?? Date.now()
    return Math.max(0, Math.floor((end - props.task.startedAt) / 1000))
  })

  let preEl: HTMLPreElement | undefined
  const setPreRef = (el: HTMLPreElement) => {
    preEl = el
  }

  // Auto-scroll the output region on each new chunk.
  createMemo(() => {
    void props.task.output
    queueMicrotask(() => {
      if (preEl) preEl.scrollTop = preEl.scrollHeight
    })
  })

  return (
    <li class={`agent-task agent-task-${props.task.status}`}>
      <header class="agent-task-head">
        <span class={`agent-task-source source-${props.task.source}`}>
          {SOURCE_LABEL[props.task.source]}
        </span>
        <span class="agent-task-spec">
          <Show
            when={!isDraft()}
            fallback={<em class="muted">{props.task.specTitle ?? '（新建中）'}</em>}
          >
            <A href={`/specs/${encodeURIComponent(props.task.specId)}`} class="agent-task-link">
              {props.task.specTitle ?? props.task.specId}
            </A>
          </Show>
        </span>
        <span class={`agent-task-status status-${props.task.status}`}>
          {STATUS_LABEL[props.task.status]}
        </span>
        <span class="agent-task-timer">{elapsed()}s</span>
        <button
          type="button"
          class="agent-task-expand"
          aria-label={props.task.expanded ? '收起' : '展开'}
          onClick={() => agentTasks.toggleExpand(props.task.runId)}
        >
          {props.task.expanded ? '收起' : '展开'}
        </button>
        <button
          type="button"
          class="agent-task-close"
          aria-label="关闭"
          onClick={() => agentTasks.dismiss(props.task.runId)}
        >
          ×
        </button>
      </header>
      <Show when={props.task.expanded}>
        <pre ref={setPreRef} class="agent-task-output">
          {props.task.output || '（等待输出…）'}
        </pre>
        <Show when={props.task.error}>
          <p class="agent-task-error">{props.task.error}</p>
        </Show>
      </Show>
    </li>
  )
}
