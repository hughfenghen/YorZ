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
import { api, type AgentLogMeta } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'

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
    <section class="page spec-agent-logs">
      <Suspense fallback={<p class="muted">加载中…</p>}>
        <header class="page-head detail-head">
          <div>
            <A class="ghost" href={projectHref(`specs/${params.id}`)}>
              ← 返回 spec
            </A>
            <h1>执行日志 · {params.id}</h1>
            <p class="summary">{spec()?.frontmatter.summary || '（待 Agent 补全）'}</p>
          </div>
          <div class="meta">
            <button
              type="button"
              class="ghost"
              onClick={() => setRefreshTick((t) => t + 1)}
              disabled={logs.loading}
            >
              {logs.loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </header>

        <section class="agent-log-list">
          <h2>Agent 执行日志（{list().length}）</h2>
          <Show when={!empty()} fallback={<p class="muted">暂无 Agent 执行日志</p>}>
            <ul class="agent-log-cards">
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
    <li class="agent-log-card">
      <button
        type="button"
        class="agent-log-card-head"
        onClick={toggle}
        aria-expanded={open()}
      >
        <span class="agent-log-card-toggle">{open() ? '▾' : '▸'}</span>
        <time class="agent-log-time">{formatTime(props.meta.startedAt)}</time>
        <span class={`agent-log-mode mode-${props.meta.mode}`}>{props.meta.mode}</span>
        <span class={`agent-log-status ${statusClass(props.meta)}`}>
          {statusLabel(props.meta)}
        </span>
        <span class="agent-log-duration">{formatDuration(props.meta)}</span>
        <span class="agent-log-size muted">{formatSize(props.meta.sizeBytes)}</span>
      </button>
      <Show when={open()}>
        <div class="agent-log-card-body">
          <Show when={state().truncated}>
            <p class="agent-log-truncated muted">已截断显示末尾 256KB</p>
          </Show>
          <Show when={state().loading}>
            <p class="muted">加载中…</p>
          </Show>
          <Show when={state().error}>
            <p class="error">{state().error}</p>
          </Show>
          <Show when={!state().loading && !state().error && state().content}>
            <pre class="agent-log-body">{state().content}</pre>
          </Show>
          <Show when={!state().loading && !state().error && !state().content}>
            <p class="muted">日志为空</p>
          </Show>
        </div>
      </Show>
    </li>
  )
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

function statusClass(meta: AgentLogMeta): string {
  if (meta.exitCode === 0) return 'status-ok'
  if (meta.exitCode === null && meta.endedAt === null) return 'status-running'
  return 'status-fail'
}

function statusLabel(meta: AgentLogMeta): string {
  if (meta.exitCode === 0) return '成功'
  if (meta.exitCode === null && meta.endedAt === null) return '未收尾'
  return `失败 (${meta.exitCode ?? 'n/a'})`
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
