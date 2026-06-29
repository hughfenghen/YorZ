import {
  For,
  Show,
  Suspense,
  createMemo,
  createResource,
  createSignal,
  type Component,
} from 'solid-js'
import { A, useNavigate } from '@solidjs/router'
import { api, type SpecListItem } from '../lib/api.js'
import type { ProjectListItem } from '../lib/project.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'

export const Home: Component = () => {
  const navigate = useNavigate()
  const projectId = useCurrentProjectId()
  const [specs, { refetch }] = createResource<SpecListItem[], string>(projectId, (pid) =>
    pid ? api.listSpecs(pid) : Promise.resolve([]),
  )
  const [projects, { refetch: refetchProjects }] = createResource<ProjectListItem[]>(() =>
    api.listProjects(),
  )

  const current = createMemo<ProjectListItem | undefined>(() =>
    (projects() ?? []).find((p) => p.id === projectId()),
  )
  const mainReachable = createMemo(() => {
    const cur = current()
    if (!cur?.worktree) return true
    return (projects() ?? []).some((p) => p.id === cur.worktree!.mainProjectId)
  })

  const [merging, setMerging] = createSignal(false)
  const [mergeError, setMergeError] = createSignal<string | null>(null)
  const [toast, setToast] = createSignal<string | null>(null)

  async function onMerge() {
    const cur = current()
    if (!cur?.worktree) return
    if (!mainReachable()) return
    const defaultMsg = `feat(${cur.worktree.branch}): merge from worktree`
    const msg = window.prompt('合入主项目的 commit message', defaultMsg)
    if (msg == null) return
    const message = msg.trim() || defaultMsg
    setMerging(true)
    setMergeError(null)
    try {
      const result = await api.mergeWorktreeToMain(cur.id, { commitMessage: message })
      if (result.status === 'merged') {
        setToast('已合入主项目，正在跳转…')
        await refetchProjects()
        navigate(`/${encodeURIComponent(result.mainProjectId)}`)
      } else {
        setToast('合并冲突，已自动新建修复 spec…')
        await refetchProjects()
        navigate(
          `/${encodeURIComponent(result.mainProjectId)}/specs/${encodeURIComponent(result.conflictSpecId)}`,
        )
      }
    } catch (err) {
      setMergeError((err as Error).message)
    } finally {
      setMerging(false)
    }
  }

  return (
    <section class="page home-page">
      <header class="page-head">
        <h1>需求列表</h1>
        <button class="ghost" onClick={() => refetch()}>
          刷新
        </button>
      </header>
      <Show when={current()?.worktree}>
        <div class="worktree-bar">
          <div class="worktree-bar-info">
            <span class="badge worktree">worktree</span>
            <code>{current()!.worktree!.branch}</code>
            <span class="muted">主项目：{current()!.worktree!.mainPath}</span>
          </div>
          <button
            type="button"
            class="primary-action"
            onClick={() => void onMerge()}
            disabled={merging() || !mainReachable()}
            title={mainReachable() ? '提交 worktree 改动并合入主项目' : '主项目不可达'}
          >
            {merging() ? '合并中…' : '⇧ 合入主项目'}
          </button>
          <Show when={!mainReachable()}>
            <span class="muted">主项目不可达</span>
          </Show>
          <Show when={mergeError()}>
            <span class="error">{mergeError()}</span>
          </Show>
          <Show when={toast()}>
            <span class="muted">{toast()}</span>
          </Show>
        </div>
      </Show>
      <Suspense fallback={<p class="muted">加载中…</p>}>
        <Show
          when={(specs() ?? []).length > 0}
          fallback={
            <div class="empty">
              <p>还没有 spec。</p>
              <A href={projectHref('specs/new')} class="primary-action">
                ＋ 新建第一个 spec
              </A>
            </div>
          }
        >
          <ul class="spec-grid">
            <For each={specs() ?? []}>
              {(spec) => (
                <li class="spec-card">
                  <A href={projectHref(`specs/${encodeURIComponent(spec.id)}`)}>
                    <div class="spec-card-head">
                      <span class={`badge stage-${spec.stage}`}>{spec.stage}</span>
                      <time>{spec.updated_at}</time>
                    </div>
                    <h2>{spec.title || '（待 Agent 补全）'}</h2>
                    <p class="summary">{spec.summary || '（待 Agent 补全）'}</p>
                    <code class="id">{spec.id}</code>
                  </A>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Suspense>
    </section>
  )
}
