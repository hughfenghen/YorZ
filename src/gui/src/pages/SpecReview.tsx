import { Show, Suspense, createMemo, createResource, createSignal, type Component } from 'solid-js'
import { A, useParams } from '@solidjs/router'
import { api, type GitOpsAction } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { renderMarkdown } from '../lib/markdown.js'
import { agentTasks } from '../lib/agent-tasks.js'

const ACTION_LABEL: Record<GitOpsAction, string> = {
  commit: '提交',
  discard: '丢弃',
  stash: '暂存',
}

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

  const [busy, setBusy] = createSignal<'review' | GitOpsAction | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [lastRun, setLastRun] = createSignal<{
    kind: 'review' | GitOpsAction
    runId: string
  } | null>(null)

  const reviewHtml = createMemo(() => {
    const text = review()?.text ?? ''
    if (!text.trim()) return ''
    return renderMarkdown(text, { specId: params.id, projectId: projectId() })
  })
  const lastReviewTime = createMemo(() => extractLastReviewTime(review()?.text ?? ''))

  async function trigger(kind: 'review' | GitOpsAction): Promise<void> {
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
      agentTasks.start({
        runId: res.runId,
        projectId: projectId(),
        mode: kind === 'review' ? 'review' : 'git-ops',
        specId: params.id,
        specTitle: spec()?.frontmatter.summary,
        source: 'run',
      })
      if (kind === 'review') {
        setTimeout(() => setRefreshTick((t) => t + 1), 1500)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
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
            disabled={busy() !== null}
            onClick={() => trigger('review')}
          >
            {busy() === 'review' ? '刷新中…' : '刷新 Review'}
          </button>
          <button
            type="button"
            class="ghost"
            disabled={busy() !== null}
            onClick={() => trigger('commit')}
          >
            {busy() === 'commit' ? '提交中…' : ACTION_LABEL.commit}
          </button>
          <button
            type="button"
            class="ghost danger"
            disabled={busy() !== null}
            onClick={() => trigger('discard')}
          >
            {busy() === 'discard' ? '丢弃中…' : ACTION_LABEL.discard}
          </button>
          <button
            type="button"
            class="ghost"
            disabled={busy() !== null}
            onClick={() => trigger('stash')}
          >
            {busy() === 'stash' ? '暂存中…' : ACTION_LABEL.stash}
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
