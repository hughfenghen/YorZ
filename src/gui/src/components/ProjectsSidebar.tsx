import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onMount,
  onCleanup,
  type Component,
} from 'solid-js'
import { A, useLocation, useNavigate } from '@solidjs/router'
import { ChevronsRight, ChevronsLeft, Pencil, X, GitBranch, HelpCircle } from 'lucide-solid'
import { api } from '../lib/api.js'
import { focusMode, exitFocusMode } from '../lib/layout-focus.js'
import type { ProjectListItem } from '../lib/project.js'
import { projectConfigRequestTick } from '../lib/shortcut-actions.js'
import { ProjectConfigDialog } from './ProjectConfigDialog.js'
import { Button } from './ui/button.jsx'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog.jsx'
import { Checkbox, CheckboxControl, CheckboxLabel } from './ui/checkbox.jsx'
import { toast } from './ui/toast.jsx'
import { subscribeProjectsList } from '../lib/sse.js'
import { t } from '../i18n/index.js'

const COLLAPSED_KEY = 'yorz.projectsSidebar.collapsed'
const WIDTH_KEY = 'yorz.projectsSidebar.width'
const DEFAULT_WIDTH = 220
const DEFAULT_WIDTH_RATIO = 0.2
const MIN_WIDTH = 160
const MAX_WIDTH = 640

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

function defaultWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  return clampWidth(window.innerWidth * DEFAULT_WIDTH_RATIO)
}

function readWidth(): number {
  try {
    if (typeof window === 'undefined') return DEFAULT_WIDTH
    const raw = window.localStorage.getItem(WIDTH_KEY)
    if (!raw) return defaultWidth()
    const n = Number(raw)
    return Number.isFinite(n) ? clampWidth(n) : defaultWidth()
  } catch {
    return defaultWidth()
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
  const [deleting, setDeleting] = createSignal<ProjectListItem | null>(null)
  const [deleteFiles, setDeleteFiles] = createSignal(false)
  const [deleteBusy, setDeleteBusy] = createSignal(false)
  const navigate = useNavigate()
  const location = useLocation()

  const activeProjectId = createMemo(() => {
    const m = location.pathname.match(/^\/([^/]+)/)
    return m && m[1] !== 'api' ? m[1]! : ''
  })

  // What the user actually sees: focus mode forces the rail shut without ever
  // touching the persisted flag, so leaving it restores their real preference.
  const isCollapsed = () => collapsed() || focusMode()

  function toggle() {
    // In focus mode the only affordance on screen is "expand" — honour it by
    // leaving focus mode and falling back to the persisted state, rather than
    // writing a new one the user never asked for.
    if (focusMode()) {
      exitFocusMode()
      return
    }
    const next = !collapsed()
    setCollapsed(next)
    writeCollapsed(next)
  }

  let dragState: { startX: number; startW: number; raf: number | null } | null = null
  let docMouseMove: ((e: MouseEvent) => void) | null = null
  let docMouseUp: (() => void) | null = null

  onMount(() => {
    const unsub = subscribeProjectsList(() => {
      void refetch()
    })
    onCleanup(unsub)
  })

  createEffect(() => {
    const tick = projectConfigRequestTick()
    if (tick === 0) return
    const pid = activeProjectId()
    const project = (projects() ?? []).find((p) => p.id === pid)
    if (project) setEditing(project)
  })

  function beginResize(ev: MouseEvent) {
    if (isCollapsed()) return
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
    if (type === 'error') toast.error(message)
    else toast.success(message)
  }

  function onRemove(p: ProjectListItem, ev: Event) {
    ev.preventDefault()
    ev.stopPropagation()
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
        toast.error(t('sidebar.uncommittedChanges'))
        setDeleting(null)
      } else {
        setError(msg)
        toast.error(msg)
      }
    } finally {
      setDeleteBusy(false)
    }
  }

  const asideStyle = () => (isCollapsed() ? undefined : { width: `${width()}px` })

  return (
    <aside
      class={`relative flex flex-col border-r bg-card shrink-0 ${
        isCollapsed() ? 'w-9 transition-[width] duration-150' : ''
      }`}
      style={asideStyle()}
    >
      <header
        class={`flex items-center border-b ${
          isCollapsed() ? 'justify-center py-2' : 'justify-between px-2.5 py-2'
        }`}
      >
        <Show
          when={!isCollapsed()}
          fallback={
            <Button
              variant="outline"
              size="sm"
              class="h-7 w-7 p-0"
              onClick={toggle}
              title={t('sidebar.expand')}
            >
              <ChevronsRight class="h-4 w-4" />
            </Button>
          }
        >
          <span class=" font-semibold tracking-wide">{t('sidebar.title')}</span>
          <div class="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              class="h-7 w-7 p-0"
              onClick={toggle}
              title={t('sidebar.collapse')}
            >
              <ChevronsLeft class="h-4 w-4" />
            </Button>
          </div>
        </Show>
      </header>

      <Show
        when={projects() !== undefined}
        fallback={<p class="px-2.5 py-2 text-muted-foreground">{t('common.loading')}</p>}
      >
        <ul class="m-0 flex-1 list-none overflow-y-auto py-1.5">
          <For each={projects() ?? []}>
            {(p) => {
              const isActive = () => activeProjectId() === p.id
              return (
                <li class="group relative flex items-center">
                  <A
                    href={`/${encodeURIComponent(p.id)}`}
                    class={`flex-1 truncate px-2.5 py-1.5 no-underline ${
                      isActive()
                        ? 'bg-accent text-accent-foreground font-semibold'
                        : 'hover:bg-muted'
                    } ${isCollapsed() ? 'px-0 text-center' : ''}`}
                    title={p.path}
                  >
                    <Show
                      when={!isCollapsed()}
                      fallback={
                        <span class="inline-block font-semibold">
                          {(p.name[0] ?? '?').toUpperCase()}
                        </span>
                      }
                    >
                      <span class="block truncate">{displayProjectName(p)}</span>
                      <Show when={p.worktree}>
                        <span
                          class="ml-1 inline-flex items-center gap-0.5 text-sm text-muted-foreground"
                          title={`worktree of ${p.worktree!.mainPath}`}
                        >
                          <GitBranch class="h-3 w-3" />
                          {t('sidebar.worktreeBadge')}
                        </span>
                      </Show>
                    </Show>
                  </A>
                  <Show when={!isCollapsed()}>
                    <button
                      type="button"
                      class="absolute right-6 top-1/2 -translate-y-1/2 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-accent-foreground group-hover:opacity-100"
                      aria-label={t('sidebar.configure', { name: p.name })}
                      title={t('sidebar.projectConfig')}
                      onClick={(e) => onEdit(p, e)}
                    >
                      <Pencil class="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      class="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      aria-label={t('sidebar.removeProject', { name: p.name })}
                      title={t('sidebar.deleteProject')}
                      onClick={(e) => void onRemove(p, e)}
                    >
                      <X class="h-3.5 w-3.5" />
                    </button>
                  </Show>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>

      <footer class={`border-t ${isCollapsed() ? 'flex justify-center py-2' : 'p-2'}`}>
        <Show
          when={!isCollapsed()}
          fallback={
            <span
              class="flex h-5 w-5 items-center justify-center rounded bg-muted text-muted-foreground"
              title={`${t('sidebar.addHint')}${t('sidebar.addCmd')}`}
            >
              <HelpCircle class="h-3.5 w-3.5" />
            </span>
          }
        >
          <p class="m-0 text-sm leading-relaxed text-muted-foreground break-words">
            {t('sidebar.addHint')}
            <code class="mt-0.5 inline-block rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] break-all">
              {t('sidebar.addCmd')}
            </code>
          </p>
        </Show>
        {error() && (
          <p class="mt-1 text-sm text-destructive break-words" title={error()!}>
            {error()}
          </p>
        )}
      </footer>

      <Show when={!isCollapsed()}>
        <div
          class="absolute right-0 top-0 z-[2] h-full w-1 cursor-col-resize bg-transparent hover:bg-accent/40"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('sidebar.resizeHint')}
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

      <Dialog
        open={deleting() !== null}
        onOpenChange={(o) => !o && !deleteBusy() && setDeleting(null)}
      >
        <DialogContent class="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('sidebar.deleteProject')}</DialogTitle>
            <DialogDescription>{t('sidebar.deleteDesc')}</DialogDescription>
          </DialogHeader>
          <Show when={deleting()}>
            {(p) => (
              <>
                <p class="break-all font-semibold">{displayProjectName(p())}</p>
                <Show when={p().worktree}>
                  <Checkbox
                    checked={deleteFiles()}
                    onChange={(v) => setDeleteFiles(v)}
                    class="flex items-center gap-2 text-destructive"
                  >
                    <CheckboxControl />
                    <CheckboxLabel>{t('sidebar.deleteFiles')}</CheckboxLabel>
                  </Checkbox>
                </Show>
              </>
            )}
          </Show>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy()}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleteBusy()}
            >
              {deleteBusy() ? t('common.deleting') : t('common.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
