import {
  For,
  Show,
  Suspense,
  createMemo,
  createResource,
  createSignal,
  type Component,
} from 'solid-js'
import { A, useParams } from '@solidjs/router'
import { ChevronRight, ChevronDown, RefreshCw } from 'lucide-solid'
import { api, type AgentLogMeta } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { Button } from '../components/ui/button.jsx'
import { t } from '../i18n/index.js'

export const SpecAgentLogs: Component = () => {
  const params = useParams<{ id: string }>()
  const projectId = useCurrentProjectId()
  const [spec] = createResource(
    () => [projectId(), params.id] as const,
    ([pid, id]) => api.getSpec(pid, id),
  )
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [logs] = createResource(
    () => [projectId(), params.id, refreshTick()] as const,
    async ([pid, id]) => api.listAgentLogs(pid, id),
  )

  const list = createMemo(() => logs() ?? [])
  const empty = createMemo(() => !logs.loading && list().length === 0)

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <Suspense fallback={<p class="text-muted-foreground">{t('common.loading')}</p>}>
        <header class="flex flex-col items-start justify-between gap-4">
          <div class="flex flex-col gap-1">
            <A class="text-sm text-muted-foreground hover:text-foreground" href={projectHref(`specs/${params.id}`)}>
              {t('agentLogs.backToSpec')}
            </A>
            <h1 class="m-0 text-xl">{t('agentLogs.title', { id: params.id })}</h1>
            <p class="text-sm text-muted-foreground">
              {spec()?.frontmatter.summary || t('common.pendingAgent')}
            </p>
          </div>
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshTick((n) => n + 1)}
              disabled={logs.loading}
            >
              <RefreshCw class={`mr-1 h-3 w-3 ${logs.loading ? 'animate-spin' : ''}`} />
              {logs.loading ? t('common.refreshing') : t('common.refresh')}
            </Button>
          </div>
        </header>

        <section class="flex flex-col gap-2">
          <h2 class="text-base font-semibold">{t('agentLogs.listTitle', { count: list().length })}</h2>
          <Show when={!empty()} fallback={<p class="text-muted-foreground">{t('agentLogs.empty')}</p>}>
            <ul class="m-0 flex list-none flex-col gap-2 p-0">
              <For each={list()}>{(meta) => <LogCard meta={meta} />}</For>
            </ul>
          </Show>
        </section>
      </Suspense>
    </section>
  )
}

interface LogState {
  content: string
  truncated: boolean
  loading: boolean
  error: string | null
}

const LogCard: Component<{ meta: AgentLogMeta }> = (props) => {
  const projectId = useCurrentProjectId()
  const [open, setOpen] = createSignal(false)
  const [state, setState] = createSignal<LogState>({
    content: '',
    truncated: false,
    loading: false,
    error: null,
  })
  let loaded = false

  async function toggle() {
    const nextOpen = !open()
    setOpen(nextOpen)
    if (nextOpen && !loaded && !state().loading) {
      setState({ content: '', truncated: false, loading: true, error: null })
      try {
        const payload = await api.getAgentLog(projectId(), props.meta.specId, props.meta.runId)
        loaded = true
        setState({
          content: payload.content,
          truncated: payload.truncated,
          loading: false,
          error: null,
        })
      } catch (err) {
        setState({
          content: '',
          truncated: false,
          loading: false,
          error: (err as Error).message,
        })
      }
    }
  }

  return (
    <li class="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-sm hover:bg-muted/50"
        onClick={toggle}
        aria-expanded={open()}
      >
        {open() ? <ChevronDown class="h-3 w-3" /> : <ChevronRight class="h-3 w-3" />}
        <time class="text-xs text-muted-foreground">{formatTime(props.meta.startedAt)}</time>
        <span class="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{agentTagLabel(props.meta)}</span>
        <span class={`text-xs font-medium ${statusColorClass(props.meta)}`}>{statusLabel(props.meta)}</span>
        <span class="text-xs">{formatDuration(props.meta)}</span>
        <span class="text-xs text-muted-foreground">{formatSize(props.meta.sizeBytes)}</span>
      </button>
      <Show when={open()}>
        <div class="border-t p-3">
          <Show when={state().truncated}>
            <p class="text-xs text-muted-foreground">{t('agentLogs.truncated')}</p>
          </Show>
          <Show when={state().loading}>
            <p class="text-muted-foreground">{t('common.loading')}</p>
          </Show>
          <Show when={state().error}>
            <p class="text-sm text-destructive">{state().error}</p>
          </Show>
          <Show when={!state().loading && !state().error && state().content}>
            <pre class="m-0 max-h-60 overflow-auto whitespace-pre-wrap bg-background p-3 font-mono text-xs">
              {state().content}
            </pre>
          </Show>
          <Show when={!state().loading && !state().error && !state().content}>
            <p class="text-muted-foreground">{t('agentLogs.emptyLog')}</p>
          </Show>
        </div>
      </Show>
    </li>
  )
}

function agentTagLabel(meta: AgentLogMeta): string {
  switch (meta.mode) {
    case 'skill-run':
      return 'Run'
    case 'explain':
      return 'Explain'
    case 'review':
      return 'Review'
    case 'git-ops':
      switch (meta.action) {
        case 'commit':
          return 'GitCommit'
        case 'discard':
          return 'GitDiscard'
        case 'stash':
          return 'GitStash'
        default:
          return 'GitOps'
      }
    default:
      return String(meta.mode)
  }
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

function statusColorClass(meta: AgentLogMeta): string {
  if (meta.exitCode === 0) return 'text-green-600'
  if (meta.exitCode === null && meta.endedAt === null) return 'text-primary'
  return 'text-destructive'
}

function statusLabel(meta: AgentLogMeta): string {
  if (meta.exitCode === 0) return t('agentLogs.success')
  if (meta.exitCode === null && meta.endedAt === null) return t('agentLogs.notFinished')
  return t('agentLogs.failed', { code: meta.exitCode ?? 'n/a' })
}

function formatDuration(meta: AgentLogMeta): string {
  if (meta.endedAt === null) return '—'
  const ms = Math.max(0, meta.endedAt - meta.startedAt)
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 100) / 10
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s - m * 60)
  return `${m}m${rem}s`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`
}
