import { A } from '@solidjs/router'
import { For, Show, createMemo, createSignal, onCleanup, type Component } from 'solid-js'
import { agentTasks, type AgentTask } from '../lib/agent-tasks.js'
import { projectHref } from '../lib/project.js'
import { Button } from './ui/button.jsx'
import { Badge } from './ui/badge.jsx'
import { ChevronUp, ChevronDown, ChevronRight, X, Loader2 } from 'lucide-solid'
import { t } from '../i18n/index.js'

const SOURCE_KEY: Record<AgentTask['source'], string> = {
  run: 'agentDock.sourceRun',
  explain: 'agentDock.sourceExplain',
  draft: 'agentDock.sourceDraft',
}

const STATUS_KEY: Record<AgentTask['status'], string> = {
  pending: 'agentDock.statusPending',
  streaming: 'agentDock.statusStreaming',
  done: 'agentDock.statusDone',
  failed: 'agentDock.statusFailed',
}

const STATUS_COLOR: Record<AgentTask['status'], string> = {
  pending: 'text-muted-foreground',
  streaming: 'text-primary',
  done: 'text-green-600',
  failed: 'text-destructive',
}

const SOURCE_COLOR: Record<AgentTask['source'], string> = {
  run: 'text-primary',
  explain: 'text-accent-foreground',
  draft: 'text-purple-600',
}

const COLLAPSE_THRESHOLD = 3
const COLLAPSED_KEY = 'yorz.agentDock.collapsed'
const SCROLL_STICK_THRESHOLD = 32

let hasPersisted = false

function readCollapsed(): boolean {
  try {
    if (typeof window === 'undefined') return false
    const raw = window.localStorage.getItem(COLLAPSED_KEY)
    if (raw === '1' || raw === '0') {
      hasPersisted = true
      return raw === '1'
    }
    return false
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
    }
  } catch {
    // ignore quota / access errors
  }
}

const AgentTaskCard: Component<{ task: AgentTask }> = (props) => {
  const [expanded, setExpanded] = createSignal(props.task.status !== 'done')
  const [stick, setStick] = createSignal(false)
  let bodyRef: HTMLPreElement | undefined

  const onScroll = () => {
    const el = bodyRef
    if (!el) return
    setStick(el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_STICK_THRESHOLD)
  }

  const scrollToBottom = () => {
    const el = bodyRef
    if (!el) return
    el.scrollTop = el.scrollHeight
  }

  createMemo(() => {
    props.task.output
    if (!expanded() || !stick()) return
    queueMicrotask(scrollToBottom)
  })

  createMemo(() => {
    props.task.status
    if (props.task.status === 'streaming' && !stick()) {
      queueMicrotask(scrollToBottom)
    }
  })

  onCleanup(() => {
    window.removeEventListener('resize', onScroll)
  })

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation()
    agentTasks.dismiss(props.task.runId)
  }

  const isDraft = () => props.task.specId.startsWith('__draft__')
  const toggleExpand = () => setExpanded((v) => !v)

  return (
    <div class="flex flex-col border rounded-md bg-background">
      <div class="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/50" onClick={toggleExpand}>
        <Show
          when={expanded()}
          fallback={<ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />}
        >
          <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
        </Show>
        <span class={`text-sm font-medium ${SOURCE_COLOR[props.task.source]}`}>
          {t(SOURCE_KEY[props.task.source])}
        </span>
        <span class="flex-1 truncate ">
          <Show
            when={!isDraft()}
            fallback={
              <em class="text-muted-foreground">
                {props.task.specTitle ?? t('common.pendingAgent')}
              </em>
            }
          >
            <A
              href={projectHref(`specs/${encodeURIComponent(props.task.specId)}`)}
              class="hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {props.task.specTitle ?? props.task.specId}
            </A>
          </Show>
        </span>
        <span class={`text-sm font-medium ${STATUS_COLOR[props.task.status]}`}>
          {t(STATUS_KEY[props.task.status])}
        </span>
        <Show when={props.task.status === 'streaming' || props.task.status === 'pending'}>
          <Loader2 class="h-3.5 w-3.5 animate-spin text-primary" />
        </Show>
        <Button
          variant="ghost"
          size="icon"
          class="h-6 w-6"
          onClick={handleClose}
        >
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
      <Show when={expanded()}>
        <pre
          ref={bodyRef}
          onScroll={onScroll}
          class="m-0 max-h-48 overflow-auto bg-background p-2 font-mono text-sm whitespace-pre-wrap border-t"
        >
          <Show
            when={props.task.output}
            fallback={
              <span class="text-muted-foreground">
                {t('agentDock.waitingOutput')}
              </span>
            }
          >
            {props.task.output}
          </Show>
        </pre>
        <Show when={props.task.status === 'pending'}>
          <div class="px-2 py-1 text-sm text-muted-foreground">
            {t('agentDock.creatingNew')}
          </div>
        </Show>
        <Show when={props.task.status === 'failed' && props.task.error}>
          <div class="px-2 py-1 text-sm text-destructive">
            {props.task.error}
          </div>
        </Show>
      </Show>
    </div>
  )
}

export const AgentPanelDock: Component = () => {
  const [collapsed, setCollapsed] = createSignal(readCollapsed())

  const visibleTasks = createMemo<AgentTask[]>(() =>
    agentTasks.state.order
      .map((id) => agentTasks.state.tasks[id])
      .filter((t): t is AgentTask => !!t && !t.dismissed),
  )

  const hasFinished = createMemo(() =>
    visibleTasks().some((t) => t.status === 'done' || t.status === 'failed'),
  )

  const runningCount = createMemo(
    () => visibleTasks().filter((t) => t.status === 'pending' || t.status === 'streaming').length,
  )
  const doneCount = createMemo(() => visibleTasks().filter((t) => t.status === 'done').length)
  const failedCount = createMemo(() => visibleTasks().filter((t) => t.status === 'failed').length)

  createMemo(() => {
    if (!hasPersisted && visibleTasks().length > COLLAPSE_THRESHOLD && !collapsed()) {
      setCollapsed(true)
      writeCollapsed(true)
      hasPersisted = true
    }
  })

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v
      writeCollapsed(next)
      return next
    })
  }

  const clearFinished = () => {
    agentTasks.clearFinished()
  }

  return (
    <Show when={visibleTasks().length > 0}>
      <div class="flex flex-col border-t bg-card shadow-lg" aria-label={t('agentDock.panelLabel')}>
        <div class="flex items-center justify-between border-b px-3 py-1.5">
          <button
            type="button"
            class="flex items-center gap-2 bg-transparent border-0 cursor-pointer"
            onClick={toggleCollapse}
            aria-expanded={!collapsed()}
            aria-label={t('agentDock.title')}
          >
            <Show
              when={collapsed()}
              fallback={<ChevronDown class="h-4 w-4 text-muted-foreground" />}
            >
              <ChevronUp class="h-4 w-4 text-muted-foreground" />
            </Show>
            <span class=" font-semibold">{t('agentDock.title')}</span>
          </button>

          <div class="flex items-center gap-2">
            <div class="flex items-center gap-0.5 text-sm text-muted-foreground">
              <span class="font-semibold text-primary">{runningCount()}</span>
              <span class="text-muted-foreground/50">/</span>
              <span class="text-green-600">{doneCount()}</span>
              <span class="text-muted-foreground/50">/</span>
              <span class="text-destructive">{failedCount()}</span>
            </div>
            <Show when={hasFinished()}>
              <Button variant="ghost" size="sm" onClick={clearFinished}>
                {t('agentDock.clearFinished')}
              </Button>
            </Show>
          </div>
        </div>

        <Show when={!collapsed()}>
          <div class="flex max-h-64 flex-col-reverse gap-1 overflow-y-auto p-1.5">
            <For each={visibleTasks()}>
              {(task) => <AgentTaskCard task={task} />}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
