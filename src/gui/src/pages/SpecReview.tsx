import {
  Show,
  Suspense,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type Component,
} from 'solid-js'
import { A, useParams } from '@solidjs/router'
import { api, type GitOpsAction } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { renderMarkdown } from '../lib/markdown.js'
import { agentTasks } from '../lib/agent-tasks.js'

type ActionKind = 'review' | GitOpsAction

const ACTION_LABEL: Record<GitOpsAction, string> = {
  commit: '提交',
  discard: '丢弃',
  stash: '暂存',
}

const LOADING_LABEL: Record<ActionKind, string> = {
  review: '刷新中…',
  commit: '提交中…',
  discard: '丢弃中…',
  stash: '暂存中…',
}

const IDLE_LABEL: Record<ActionKind, string> = {
  review: '刷新 Review',
  commit: ACTION_LABEL.commit,
  discard: ACTION_LABEL.discard,
  stash: ACTION_LABEL.stash,
}

const ALL_KINDS: ActionKind[] = ['review', 'commit', 'discard', 'stash']

export const SpecReview: Component = () => {
  const params = useParams<{ id: string }>()
  const projectId = useCurrentProjectId()
  const [spec] = createResource(
    () => [projectId(), params.id] as const,
    ([pid, id]) => api.getSpec(pid, id),
  )
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [review] = createResource(
    () => [projectId(), params.id, refreshTick()] as const,
    async ([pid, id]) => api.getReview(pid, id),
  )

  const [busy, setBusy] = createSignal<ActionKind | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [lastRun, setLastRun] = createSignal<{
    kind: ActionKind
    runId: string
  } | null>(null)
  const [activeRuns, setActiveRuns] = createSignal<Partial<Record<ActionKind, string>>>({})

  const reviewHtml = createMemo(() => {
    const text = review()?.text ?? ''
    if (!text.trim()) return ''
    return renderMarkdown(text, { specId: params.id, projectId: projectId() })
  })
  const lastReviewTime = createMemo(() => extractLastReviewTime(review()?.text ?? ''))

  function isKindRunning(kind: ActionKind): boolean {
    const runId = activeRuns()[kind]
    if (!runId) return false
    const t = agentTasks.state.tasks[runId]
    if (!t) return false
    return t.status === 'pending' || t.status === 'streaming'
  }
  const runningKind = createMemo<ActionKind | null>(() => {
    for (const k of ALL_KINDS) if (isKindRunning(k)) return k
    return null
  })
  const isAnyRunning = createMemo(() => busy() !== null || runningKind() !== null)

  createEffect<'pending' | 'streaming' | 'done' | 'failed' | undefined>((prev) => {
    const runId = activeRuns().review
    if (!runId) return undefined
    const status = agentTasks.state.tasks[runId]?.status
    if (
      (prev === 'pending' || prev === 'streaming') &&
      (status === 'done' || status === 'failed')
    ) {
      setRefreshTick((t) => t + 1)
    }
    return status
  }, undefined)

  async function trigger(kind: ActionKind): Promise<void> {
    if (isAnyRunning()) return
    setError(null)
    if (kind === 'discard') {
      const ok = window.confirm('确定要丢弃当前 spec 相关的所有未提交变更吗？此操作不可撤销。')
      if (!ok) return
    }
    setBusy(kind)
    try {
      const res =
        kind === 'review'
          ? await api.triggerReview(projectId(), params.id)
          : await api.gitOp(projectId(), params.id, kind)
      setLastRun({ kind, runId: res.runId })
      setActiveRuns((prev) => ({ ...prev, [kind]: res.runId }))
      agentTasks.start({
        runId: res.runId,
        projectId: projectId(),
        mode: kind === 'review' ? 'review' : 'git-ops',
        specId: params.id,
        specTitle: spec()?.frontmatter.summary,
        source: 'run',
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function buttonLoading(kind: ActionKind): boolean {
    return isKindRunning(kind) || busy() === kind
  }

  return (
    <section class="page spec-review">
      <Suspense fallback={<p class="muted">加载中…</p>}>
        <header class="page-head detail-head">
          <div>
            <A class="ghost" href={projectHref(`specs/${params.id}`)}>
              ← 返回 spec
            </A>
            <h1>Review · {params.id}</h1>
            <p class="summary">{spec()?.frontmatter.summary || '（待 Agent 补全）'}</p>
          </div>
          <div class="meta">
            <Show when={lastReviewTime()}>
              <span class="muted">最近一次 review：{lastReviewTime()}</span>
            </Show>
          </div>
        </header>

        <section class="review-actions">
          <button
            type="button"
            class="primary-action"
            disabled={isAnyRunning()}
            onClick={() => trigger('review')}
          >
            <Show when={buttonLoading('review')}>
              <span class="review-action-spinner" aria-hidden="true" />
            </Show>
            {buttonLoading('review') ? LOADING_LABEL.review : IDLE_LABEL.review}
          </button>
          <button
            type="button"
            class="ghost"
            disabled={isAnyRunning()}
            onClick={() => trigger('commit')}
          >
            <Show when={buttonLoading('commit')}>
              <span class="review-action-spinner" aria-hidden="true" />
            </Show>
            {buttonLoading('commit') ? LOADING_LABEL.commit : IDLE_LABEL.commit}
          </button>
          <button
            type="button"
            class="ghost danger"
            disabled={isAnyRunning()}
            onClick={() => trigger('discard')}
          >
            <Show when={buttonLoading('discard')}>
              <span class="review-action-spinner" aria-hidden="true" />
            </Show>
            {buttonLoading('discard') ? LOADING_LABEL.discard : IDLE_LABEL.discard}
          </button>
          <button
            type="button"
            class="ghost"
            disabled={isAnyRunning()}
            onClick={() => trigger('stash')}
          >
            <Show when={buttonLoading('stash')}>
              <span class="review-action-spinner" aria-hidden="true" />
            </Show>
            {buttonLoading('stash') ? LOADING_LABEL.stash : IDLE_LABEL.stash}
          </button>
        </section>

        <Show when={error()}>
          <p class="error">{error()}</p>
        </Show>
        <Show when={lastRun()}>
          <p class="muted">
            已派发：
            {lastRun()!.kind === 'review'
              ? '刷新 Review'
              : ACTION_LABEL[lastRun()!.kind as GitOpsAction]}
            （runId: <code>{lastRun()!.runId.slice(0, 8)}</code>）
          </p>
        </Show>

        <section class="review-body">
          <Show
            when={review.loading}
            fallback={
              <Show
                when={reviewHtml()}
                fallback={<p class="muted">尚无 review 报告。点击「刷新 Review」让 Agent 生成。</p>}
              >
                <article class="markdown review-md" innerHTML={reviewHtml()} />
              </Show>
            }
          >
            <p class="muted">加载中…</p>
          </Show>
        </section>
      </Suspense>
    </section>
  )
}

function extractLastReviewTime(text: string): string {
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*$/.exec(lines[i] ?? '')
    if (m) return m[1] ?? ''
  }
  return ''
}
