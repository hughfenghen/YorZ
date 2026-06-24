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

const COLLAPSED_KEY = 'yorz.projectsSidebar.collapsed'
const WIDTH_KEY = 'yorz.projectsSidebar.width'
const DEFAULT_WIDTH = 220
const MIN_WIDTH = 160
const MAX_WIDTH = 480

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

interface PickerWindow extends Window {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<{ name: string }>
}

/**
 * Show the browser directory picker (when supported) then prompt the user for
 * the absolute path of the chosen directory. Returns null when the user
 * cancels at any step.
 */
export async function promptAddProject(): Promise<string | null> {
  let suggestedName = ''
  const win = typeof window !== 'undefined' ? (window as PickerWindow) : undefined
  if (win?.showDirectoryPicker) {
    try {
      const handle = await win.showDirectoryPicker({ mode: 'read' })
      suggestedName = handle.name
    } catch {
      // user cancelled / not allowed; fall through to manual entry
    }
  }
  const message = suggestedName
    ? `请输入项目根目录的绝对路径（建议：${suggestedName}）`
    : '请输入项目根目录的绝对路径'
  const input = window.prompt(message, '')
  if (!input) return null
  const trimmed = input.trim()
  return trimmed || null
}

function pickerSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export const ProjectsSidebar: Component = () => {
  const [collapsed, setCollapsed] = createSignal(readCollapsed())
  const [width, setWidth] = createSignal(readWidth())
  const [projects, { refetch }] = createResource<ProjectListItem[]>(() => api.listProjects())
  const [adding, setAdding] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
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

  async function onAdd() {
    if (adding()) return
    setError(null)
    setAdding(true)
    try {
      const path = await promptAddProject()
      if (!path) return
      const entry = await api.addProject(path)
      await refetch()
      navigate(`/${encodeURIComponent(entry.id)}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAdding(false)
    }
  }

  async function onRemove(p: ProjectListItem, ev: Event) {
    ev.preventDefault()
    ev.stopPropagation()
    const ok = window.confirm(
      `从列表中移除项目「${p.name}」？\n` +
        `仅会从 YorZ 全局配置中删除，磁盘上的 ${p.path}/.yorz/ 目录不会被删除。`,
    )
    if (!ok) return
    try {
      await api.removeProject(p.id)
      await refetch()
      if (activeProjectId() === p.id) {
        navigate('/')
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // Periodically refetch so lastActivityAt updates from agent runs surface.
  const timer = setInterval(() => void refetch(), 30_000)
  onCleanup(() => clearInterval(timer))

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
          <button
            type="button"
            class="projects-sidebar-toggle"
            onClick={toggle}
            title="折叠"
            aria-label="折叠项目面板"
          >
            «
          </button>
        </Show>
      </header>

      <Show
        when={!projects.loading}
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
                      <span class="name">{p.name}</span>
                    </Show>
                  </A>
                  <Show when={!collapsed()}>
                    <button
                      type="button"
                      class="projects-sidebar-remove"
                      aria-label={`移除 ${p.name}`}
                      title="从列表移除（不删除磁盘文件）"
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
        <button
          type="button"
          class="projects-sidebar-add"
          disabled={adding() || !pickerSupportedClient()}
          title={
            pickerSupportedClient()
              ? '添加一个项目目录'
              : '当前浏览器不支持 showDirectoryPicker，请使用 Chrome/Edge 等现代浏览器'
          }
          onClick={() => void onAdd()}
        >
          <Show when={!collapsed()} fallback={<span>＋</span>}>
            <span>＋ 添加项目</span>
          </Show>
        </button>
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
    </aside>
  )
}

function pickerSupportedClient(): boolean {
  return pickerSupported()
}
