import {
  For,
  Show,
  Suspense,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js'
import { A, useNavigate } from '@solidjs/router'
import { api, type SpecListItem } from '../lib/api.js'
import type { ProjectListItem } from '../lib/project.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { subscribeProjectsList } from '../lib/sse.js'
import { formatSpecUpdatedAt } from '../lib/time.js'

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
  const [menuSpecId, setMenuSpecId] = createSignal<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal(false)
  const [deleteError, setDeleteError] = createSignal<string | null>(null)

  onMount(() => {
    const unsub = subscribeProjectsList(() => {
      void (async () => {
        const previousMainId = current()?.worktree?.mainProjectId ?? null
        await refetchProjects()
        const pid = projectId()
        if (!pid) return
        const stillExists = (projects() ?? []).some((p) => p.id === pid)
        if (stillExists) return
        // Worktree we were viewing got cleaned up — fall back to its main project.
        if (previousMainId) navigate(`/${encodeURIComponent(previousMainId)}`)
      })()
    })
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.card-menu') || target.closest('.card-menu-trigger')) return
      if (menuSpecId()) {
        setMenuSpecId(null)
        setConfirmDeleteId(null)
      }
    }
    document.addEventListener('click', onDocClick)
    onCleanup(() => {
      unsub()
      document.removeEventListener('click', onDocClick)
    })
  })

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
        setToast('冲突 spec 已自动派给 Agent 处理，列表会在合并完成后自动刷新')
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

  async function onDeleteSpec(specId: string) {
    const pid = projectId()
    if (!pid) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteSpec(pid, specId)
      setConfirmDeleteId(null)
      setMenuSpecId(null)
      await refetch()
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeleting(false)
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
            <span class="muted">
              主项目：
              {current()!.worktree!.mainPath.split('/').filter(Boolean).pop() ??
                current()!.worktree!.mainPath}
            </span>
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
                      <time>{formatSpecUpdatedAt(spec.updated_at)}</time>
                    </div>
                    <h2>{spec.title || '（待 Agent 补全）'}</h2>
                    <p class="summary">{spec.summary || '（待 Agent 补全）'}</p>
                    <code class="id">{spec.id}</code>
                  </A>
                  <Show when={menuSpecId() === spec.id}>
                    <div
                      class="card-menu"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                    >
                      <Show
                        when={confirmDeleteId() === spec.id}
                        fallback={
                          <button
                            type="button"
                            class="card-menu-item danger"
                            onClick={() => setConfirmDeleteId(spec.id)}
                          >
                            删除
                          </button>
                        }
                      >
                        <div class="card-menu-confirm">
                          <p>确定删除此 spec？</p>
                          <Show when={deleteError()}>
                            <p class="error">{deleteError()}</p>
                          </Show>
                          <div class="card-menu-confirm-actions">
                            <button
                              type="button"
                              class="ghost"
                              disabled={deleting()}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              class="danger-btn"
                              disabled={deleting()}
                              onClick={() => void onDeleteSpec(spec.id)}
                            >
                              {deleting() ? '删除中…' : '确认删除'}
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>
                  <button
                    type="button"
                    class="card-menu-trigger"
                    title="更多操作"
                    aria-label="更多操作"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setMenuSpecId((cur) => (cur === spec.id ? null : spec.id))
                      setConfirmDeleteId(null)
                      setDeleteError(null)
                    }}
                  >
                    ⋯
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Suspense>
    </section>
  )
}
