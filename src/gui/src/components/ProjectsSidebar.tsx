import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { A, useLocation, useNavigate } from '@solidjs/router'
import { api } from '../lib/api.js'
import type { ProjectListItem } from '../lib/project.js'
import { ProjectConfigDialog } from './ProjectConfigDialog.js'

const COLLAPSED_KEY = 'yorz.projectsSidebar.collapsed'
const WIDTH_KEY = 'yorz.projectsSidebar.width'
const DEFAULT_WIDTH = 220
const MIN_WIDTH = 160
const MAX_WIDTH = 480

const ADD_HINT_TEXT = '添加项目请在终端执行：'
const ADD_HINT_CMD = 'yorz add <path>'

function readCollapsed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSED_KEY) === '1'
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
    // ignore quota errors
  }
}

function clampWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)))
}

function readWidth(): number {
  try {
    if (typeof window === 'undefined') return DEFAULT_WIDTH
    const raw = window.localStorage.getItem(WIDTH_KEY)
    if (!raw) return DEFAULT_WIDTH
    const n = Number(raw)
    return Number.isFinite(n) ? clampWidth(n) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

function writeWidth(value: number): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WIDTH_KEY, String(clampWidth(value)))
    }
  } catch {
    // ignore quota errors
  }
}

function displayProjectName(p: ProjectListItem): string {
  if (!p.worktree) return p.name
  const mainBasename = p.worktree.mainPath.split('/').filter(Boolean).pop() ?? p.worktree.mainPath
  const slug = p.worktree.cleanSlug ?? p.worktree.branch.replace(/^wt\//, '')
  return `${mainBasename} · ${slug}`
}

export const ProjectsSidebar: Component = () => {
  const [collapsed, setCollapsed] = createSignal(readCollapsed())
  const [width, setWidth] = createSignal(readWidth())
  const [projects, { refetch }] = createResource<ProjectListItem[]>(() => api.listProjects())
  const [error, setError] = createSignal<string | null>(null)
  const [editing, setEditing] = createSignal<ProjectListItem | null>(null)
  const [toast, setToast] = createSignal<{ message: string; type: 'success' | 'error' } | null>(
    null,
  )
  const [deleting, setDeleting] = createSignal<ProjectListItem | null>(null)
  const [deleteFiles, setDeleteFiles] = createSignal(false)
  const [deleteBusy, setDeleteBusy] = createSignal(false)
  const [deletePopoverPos, setDeletePopoverPos] = createSignal<{ top: number; left: number }>({
    top: 0,
    left: 0,
  })
  const navigate = useNavigate()
  const location = useLocation()

  const activeProjectId = createMemo(() => {
    const m = location.pathname.match(/^\/([^/]+)/)
    return m && m[1] !== 'api' ? m[1]! : ''
  })

  function toggle() {
    const next = !collapsed()
    setCollapsed(next)
    writeCollapsed(next)
  }

  // Drag-to-resize: install document-level listeners only while dragging so we
  // don't leak handlers between mousedowns.
  let dragState: { startX: number; startW: number; raf: number | null } | null = null
  let docMouseMove: ((e: MouseEvent) => void) | null = null
  let docMouseUp: (() => void) | null = null

  function beginResize(ev: MouseEvent) {
    if (collapsed()) return
    ev.preventDefault()
    dragState = { startX: ev.clientX, startW: width(), raf: null }
    document.body.classList.add('is-resizing')

    docMouseMove = (e: MouseEvent) => {
      if (!dragState) return
      const delta = e.clientX - dragState.startX
      const next = clampWidth(dragState.startW + delta)
      if (dragState.raf != null) return
      dragState.raf = requestAnimationFrame(() => {
        if (!dragState) return
        dragState.raf = null
        setWidth(next)
      })
    }
    docMouseUp = () => {
      if (dragState?.raf != null) cancelAnimationFrame(dragState.raf)
      dragState = null
      document.body.classList.remove('is-resizing')
      if (docMouseMove) document.removeEventListener('mousemove', docMouseMove)
      if (docMouseUp) document.removeEventListener('mouseup', docMouseUp)
      docMouseMove = null
      docMouseUp = null
      writeWidth(width())
    }

    document.addEventListener('mousemove', docMouseMove)
    document.addEventListener('mouseup', docMouseUp)
  }

  onCleanup(() => {
    if (docMouseMove) document.removeEventListener('mousemove', docMouseMove)
    if (docMouseUp) document.removeEventListener('mouseup', docMouseUp)
    document.body.classList.remove('is-resizing')
  })

  function onEdit(p: ProjectListItem, ev: Event) {
    ev.preventDefault()
    ev.stopPropagation()
    setEditing(p)
  }

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    const payload = { message, type }
    setToast(payload)
    setTimeout(() => {
      if (toast() === payload) setToast(null)
    }, 4000)
  }

  function onRemove(p: ProjectListItem, ev: Event) {
    ev.preventDefault()
    ev.stopPropagation()
    const btn = ev.currentTarget as HTMLElement
    const rect = btn.getBoundingClientRect()
    const popoverWidth = 280
    let left = rect.right - popoverWidth
    if (left < 8) left = 8
    setDeletePopoverPos({ top: rect.bottom + 8, left })
    setDeleteFiles(false)
    setDeleting(p)
  }

  async function confirmDelete() {
    const p = deleting()
    if (!p) return
    setDeleteBusy(true)
    try {
      if (deleteFiles() && p.worktree) {
        await api.removeProjectWithFiles(p.id)
      } else {
        await api.removeProject(p.id)
      }
      await refetch()
      if (activeProjectId() === p.id) navigate('/')
      setDeleting(null)
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('409')) {
        showToast('存在未提交 git 的变更', 'error')
        setDeleting(null)
      } else {
        setError(msg)
        showToast(msg, 'error')
      }
    } finally {
      setDeleteBusy(false)
    }
  }

  function onRefresh() {
    void refetch()
  }

  const asideStyle = () => (collapsed() ? undefined : { width: `${width()}px` })

  return (
    <aside
      class={`projects-sidebar ${collapsed() ? 'collapsed' : 'expanded'}`}
      style={asideStyle()}
    >
      <header class="projects-sidebar-head">
        <Show
          when={!collapsed()}
          fallback={
            <button
              type="button"
              class="projects-sidebar-toggle"
              onClick={toggle}
              title="展开项目面板"
              aria-label="展开项目面板"
            >
              »
            </button>
          }
        >
          <span class="projects-sidebar-title">项目</span>
          <div class="projects-sidebar-head-actions">
            <button
              type="button"
              class="projects-sidebar-refresh"
              onClick={onRefresh}
              disabled={projects.loading}
              title="刷新项目列表"
              aria-label="刷新项目列表"
            >
              <span class={`projects-sidebar-refresh-icon ${projects.loading ? 'spinning' : ''}`}>
                ⟳
              </span>
            </button>
            <button
              type="button"
              class="projects-sidebar-toggle"
              onClick={toggle}
              title="折叠"
              aria-label="折叠项目面板"
            >
              «
            </button>
          </div>
        </Show>
      </header>

      <Show
        when={projects() !== undefined}
        fallback={<p class="muted projects-sidebar-loading">加载中…</p>}
      >
        <ul class="projects-sidebar-list">
          <For each={projects() ?? []}>
            {(p) => {
              const isActive = () => activeProjectId() === p.id
              return (
                <li class={`projects-sidebar-item ${isActive() ? 'active' : ''}`}>
                  <A
                    href={`/${encodeURIComponent(p.id)}`}
                    class="projects-sidebar-link"
                    title={p.path}
                  >
                    <Show
                      when={!collapsed()}
                      fallback={<span class="initial">{(p.name[0] ?? '?').toUpperCase()}</span>}
                    >
                      <span class="name">{displayProjectName(p)}</span>
                      <Show when={p.worktree}>
                        <span class="worktree-badge" title={`worktree of ${p.worktree!.mainPath}`}>
                          ⎇ main
                        </span>
                      </Show>
                    </Show>
                  </A>
                  <Show when={!collapsed()}>
                    <button
                      type="button"
                      class="projects-sidebar-edit"
                      aria-label={`配置 ${p.name}`}
                      title="项目配置"
                      onClick={(e) => onEdit(p, e)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      class="projects-sidebar-remove"
                      aria-label={`移除 ${p.name}`}
                      title="删除项目"
                      onClick={(e) => void onRemove(p, e)}
                    >
                      ✕
                    </button>
                  </Show>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>

      <footer class="projects-sidebar-foot">
        <Show
          when={!collapsed()}
          fallback={
            <span
              class="projects-sidebar-hint-icon"
              title={`${ADD_HINT_TEXT}${ADD_HINT_CMD}`}
              aria-label={`${ADD_HINT_TEXT}${ADD_HINT_CMD}`}
            >
              ?
            </span>
          }
        >
          <p class="projects-sidebar-hint">
            {ADD_HINT_TEXT}
            <code>{ADD_HINT_CMD}</code>
          </p>
        </Show>
        {error() && (
          <p class="error projects-sidebar-error" title={error()!}>
            {error()}
          </p>
        )}
      </footer>

      <Show when={!collapsed()}>
        <div
          class="projects-sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整项目面板宽度"
          onMouseDown={beginResize}
        />
      </Show>

      <Show when={editing()}>
        {(p) => (
          <ProjectConfigDialog
            open
            projectId={p().id}
            projectName={p().name}
            onClose={() => setEditing(null)}
            onSaved={(msg) => showToast(msg)}
          />
        )}
      </Show>

      <Show when={toast()}>
        {(t) => (
          <div
            class={`projects-sidebar-toast projects-sidebar-toast--${t().type}`}
            role={t().type === 'error' ? 'alert' : 'status'}
          >
            {t().message}
          </div>
        )}
      </Show>

      <Show when={deleting()}>
        {(p) => (
          <>
            <div
              class="delete-popover-backdrop"
              onClick={() => !deleteBusy() && setDeleting(null)}
            />
            <div
              class="delete-project-popover"
              style={{
                top: `${deletePopoverPos().top}px`,
                left: `${deletePopoverPos().left}px`,
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header>
                <strong>删除项目</strong>
              </header>
              <p class="delete-project-name">{displayProjectName(p())}</p>
              <p class="delete-project-desc">此操作将从 YorZ 项目列表中移除该项目。</p>
              <Show when={p().worktree}>
                <label class="delete-files-check">
                  <input
                    type="checkbox"
                    checked={deleteFiles()}
                    onChange={(e) => setDeleteFiles(e.currentTarget.checked)}
                  />
                  同时删除文件目录
                </label>
              </Show>
              <div class="delete-project-actions">
                <button type="button" onClick={() => setDeleting(null)} disabled={deleteBusy()}>
                  取消
                </button>
                <button
                  type="button"
                  class="delete-confirm-btn"
                  onClick={() => void confirmDelete()}
                  disabled={deleteBusy()}
                >
                  {deleteBusy() ? '删除中…' : '确认删除'}
                </button>
              </div>
            </div>
          </>
        )}
      </Show>
    </aside>
  )
}
