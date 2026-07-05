import {
  For,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js'
import { A, useParams } from '@solidjs/router'
import { api, type GitOpsAction, type GitChange } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { renderMarkdown } from '../lib/markdown.js'
import { agentTasks } from '../lib/agent-tasks.js'
import { subscribeChanges } from '../lib/sse.js'

type ActionKind = 'review' | GitOpsAction
type FileSelectMode = 'manual' | 'agent'

const ACTION_LABEL: Record<GitOpsAction, string> = {
  commit: '提交',
  discard: '丢弃',
  stash: '暂存',
}

const LOADING_LABEL: Record<ActionKind, string> = {
  review: 'Review 中…',
  commit: '提交中…',
  discard: '丢弃中…',
  stash: '暂存中…',
}

const IDLE_LABEL: Record<ActionKind, string> = {
  review: 'Review 变更',
  commit: ACTION_LABEL.commit,
  discard: ACTION_LABEL.discard,
  stash: ACTION_LABEL.stash,
}

const ALL_KINDS: ActionKind[] = ['review', 'commit', 'discard', 'stash']

const STATUS_CLASS: Record<string, string> = {
  M: 'st-modified',
  A: 'st-added',
  D: 'st-deleted',
  '??': 'st-untracked',
  R: 'st-renamed',
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

  const [changes, setChanges] = createSignal<GitChange[]>([])
  const [fileSelectMode, setFileSelectMode] = createSignal<FileSelectMode>('manual')
  const [selectedPaths, setSelectedPaths] = createSignal<Set<string>>(new Set())
  const [commitMessage, setCommitMessage] = createSignal('')
  const [userEditedMsg, setUserEditedMsg] = createSignal(false)
  const [directAction, setDirectAction] = createSignal<GitOpsAction | null>(null)

  const [busy, setBusy] = createSignal<ActionKind | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [lastRun, setLastRun] = createSignal<{ kind: ActionKind; runId: string } | null>(null)
  const [activeRuns, setActiveRuns] = createSignal<Partial<Record<ActionKind, string>>>({})

  let commitMsgRef: HTMLTextAreaElement | undefined

  function autoResize(el: HTMLTextAreaElement | undefined): void {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  const reviewHtml = createMemo(() => {
    const text = review()?.text ?? ''
    if (!text.trim()) return ''
    return renderMarkdown(text, { specId: params.id, projectId: projectId() })
  })
  const lastReviewTime = createMemo(() => extractLastReviewTime(review()?.text ?? ''))

  const defaultCommitMessage = createMemo(() => {
    const parts = params.id.split('.')
    const type = parts.length >= 2 ? parts[1]! : 'feat'
    const summary = spec()?.frontmatter.summary ?? ''
    return summary ? `${type}: ${summary}` : `${type}: update`
  })

  createEffect(() => {
    const msg = defaultCommitMessage()
    if (msg && !userEditedMsg()) setCommitMessage(msg)
  })

  createEffect(
    on(commitMessage, () => {
      autoResize(commitMsgRef)
    }),
  )

  onMount(() => autoResize(commitMsgRef))

  createEffect(() => {
    const pid = projectId()
    const id = params.id
    if (!pid || !id) return
    const unsub = subscribeChanges(pid, id, (newChanges) => {
      setChanges(newChanges)
      setSelectedPaths((prev) => {
        const validPaths = new Set(newChanges.map((c) => c.path))
        const next = new Set<string>()
        for (const p of prev) if (validPaths.has(p)) next.add(p)
        return next
      })
    })
    onCleanup(() => unsub())
  })

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
  const isAnyRunning = createMemo(
    () => busy() !== null || runningKind() !== null || directAction() !== null,
  )

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

  function getPaths(): string[] {
    if (fileSelectMode() === 'agent') return changes().map((c) => c.path)
    return [...selectedPaths()]
  }

  async function triggerDirect(kind: GitOpsAction): Promise<void> {
    if (isAnyRunning()) return
    setError(null)
    const paths = getPaths()
    if (paths.length === 0) {
      setError('请至少选择一个文件')
      return
    }
    if (kind === 'discard') {
      const ok = window.confirm('确定要丢弃选中的变更吗？此操作不可撤销。')
      if (!ok) return
    }
    setDirectAction(kind)
    try {
      if (kind === 'commit') {
        const message = commitMessage().trim()
        if (!message) {
          setError('请输入 commit message')
          return
        }
        await api.directCommit(projectId(), params.id, { message, paths })
      } else if (kind === 'discard') {
        await api.directDiscard(projectId(), params.id, { paths })
      } else if (kind === 'stash') {
        await api.directStash(projectId(), params.id, {
          message: commitMessage().trim() || `yorz:${params.id}`,
          paths,
        })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDirectAction(null)
    }
  }

  async function triggerAgent(kind: ActionKind): Promise<void> {
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

  async function triggerGit(kind: GitOpsAction): Promise<void> {
    if (fileSelectMode() === 'manual') await triggerDirect(kind)
    else await triggerAgent(kind)
  }

  function buttonLoading(kind: ActionKind): boolean {
    return isKindRunning(kind) || busy() === kind || directAction() === kind
  }

  function togglePath(path: string): void {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleAll(): void {
    if (changes().every((c) => selectedPaths().has(c.path))) {
      setSelectedPaths(new Set<string>())
    } else {
      setSelectedPaths(new Set(changes().map((c) => c.path)))
    }
  }

  const allSelected = createMemo(
    () => changes().length > 0 && changes().every((c) => selectedPaths().has(c.path)),
  )

  const manualNoSelection = createMemo(
    () => fileSelectMode() === 'manual' && selectedPaths().size === 0,
  )

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

        <div class="review-split">
          <section class="review-ops-panel">
            <section class="review-actions">
              <button
                type="button"
                class="primary-action"
                disabled={isAnyRunning() || manualNoSelection()}
                onClick={() => triggerGit('commit')}
              >
                <Show when={buttonLoading('commit')}>
                  <span class="review-action-spinner" aria-hidden="true" />
                </Show>
                {buttonLoading('commit') ? LOADING_LABEL.commit : IDLE_LABEL.commit}
              </button>
              <button
                type="button"
                class="ghost danger"
                disabled={isAnyRunning() || manualNoSelection()}
                onClick={() => triggerGit('discard')}
              >
                <Show when={buttonLoading('discard')}>
                  <span class="review-action-spinner" aria-hidden="true" />
                </Show>
                {buttonLoading('discard') ? LOADING_LABEL.discard : IDLE_LABEL.discard}
              </button>
              <button
                type="button"
                class="ghost"
                disabled={isAnyRunning() || manualNoSelection()}
                onClick={() => triggerGit('stash')}
              >
                <Show when={buttonLoading('stash')}>
                  <span class="review-action-spinner" aria-hidden="true" />
                </Show>
                {buttonLoading('stash') ? LOADING_LABEL.stash : IDLE_LABEL.stash}
              </button>
              <span class="actions-separator" />
              <button
                type="button"
                class="ghost"
                title="Review 下方变更文件，生成报告"
                disabled={isAnyRunning() || changes().length === 0}
                onClick={() => triggerAgent('review')}
              >
                <Show when={buttonLoading('review')}>
                  <span class="review-action-spinner" aria-hidden="true" />
                </Show>
                {buttonLoading('review') ? LOADING_LABEL.review : IDLE_LABEL.review}
              </button>
            </section>

            <textarea
              ref={commitMsgRef}
              class="commit-message-input"
              placeholder="commit message…"
              value={commitMessage()}
              onInput={(e) => {
                setUserEditedMsg(true)
                setCommitMessage(e.currentTarget.value)
                autoResize(commitMsgRef)
              }}
              disabled={isAnyRunning()}
              rows={2}
            />

            <div class="file-mode-group">
              <label class="file-mode-label">
                <input
                  type="radio"
                  name="fileMode"
                  checked={fileSelectMode() === 'manual'}
                  onChange={() => setFileSelectMode('manual')}
                  disabled={isAnyRunning()}
                />
                手动选择
              </label>
              <label class="file-mode-label">
                <input
                  type="radio"
                  name="fileMode"
                  checked={fileSelectMode() === 'agent'}
                  onChange={() => setFileSelectMode('agent')}
                  disabled={isAnyRunning()}
                />
                Agent 智能判定
              </label>
            </div>

            <Show when={fileSelectMode() === 'manual' && changes().length > 0}>
              <div class="changes-list">
                <div class="changes-list-head">
                  <button
                    type="button"
                    class="ghost small"
                    onClick={toggleAll}
                    disabled={isAnyRunning()}
                  >
                    {allSelected() ? '全部取消' : '全选'}
                  </button>
                  <span class="muted">
                    {selectedPaths().size}/{changes().length} 个文件
                  </span>
                </div>
                <For each={changes()}>
                  {(change) => (
                    <label class="change-item">
                      <input
                        type="checkbox"
                        checked={selectedPaths().has(change.path)}
                        onChange={() => togglePath(change.path)}
                        disabled={isAnyRunning()}
                      />
                      <span class={`change-status ${STATUS_CLASS[change.status] ?? ''}`}>
                        {change.status}
                      </span>
                      <span class="change-path">{change.path}</span>
                    </label>
                  )}
                </For>
              </div>
            </Show>
            <Show when={fileSelectMode() === 'manual' && changes().length === 0}>
              <p class="muted">暂无变更文件</p>
            </Show>

            <Show when={error()}>
              <p class="error">{error()}</p>
            </Show>
            <Show when={lastRun()}>
              <p class="muted">
                已派发：
                {lastRun()!.kind === 'review'
                  ? 'Review 变更'
                  : ACTION_LABEL[lastRun()!.kind as GitOpsAction]}
                （runId: <code>{lastRun()!.runId.slice(0, 8)}</code>）
              </p>
            </Show>
          </section>

          <section class="review-body">
            <Show
              when={review.loading}
              fallback={
                <Show
                  when={reviewHtml()}
                  fallback={
                    <p class="muted">尚无 review 报告。点击「Review 变更」让 Agent 生成。</p>
                  }
                >
                  <article class="markdown review-md" innerHTML={reviewHtml()} />
                </Show>
              }
            >
              <p class="muted">加载中…</p>
            </Show>
          </section>
        </div>
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
