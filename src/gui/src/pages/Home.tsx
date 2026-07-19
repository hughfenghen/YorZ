import {
  For,
  Show,
  Suspense,
  createMemo,
  createEffect,
  createResource,
  createSignal,
  onMount,
  onCleanup,
  type Component,
} from 'solid-js'
import { A, useNavigate } from '@solidjs/router'
import { Plus, MoreHorizontal, GitMerge } from 'lucide-solid'
import { api, type SpecListItem } from '../lib/api.js'
import type { ProjectListItem } from '../lib/project.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { useFocusModePage } from '../lib/layout-focus.js'
import { subscribeProjectsList, subscribeSpecsList } from '../lib/sse.js'
import { formatSpecUpdatedAt } from '../lib/time.js'
import { Button } from '../components/ui/button.jsx'
import { Badge } from '../components/ui/badge.jsx'
import { FocusModeButton } from '../components/FocusModeButton.jsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../components/ui/dropdown-menu.jsx'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog.jsx'
import { toast } from '../components/ui/sonner.jsx'
import { t } from '../i18n/index.js'

const STAGE_BG: Record<string, string> = {
  plan: 'bg-stage-plan',
  tasks: 'bg-stage-tasks',
  execute: 'bg-stage-execute',
  done: 'bg-stage-done',
}

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
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal(false)
  const [deleteError, setDeleteError] = createSignal<string | null>(null)
  useFocusModePage(() => confirmDeleteId() !== null)

  let cleanupSpecsList: (() => void) | null = null

  createEffect(() => {
    const pid = projectId()
    cleanupSpecsList?.()
    cleanupSpecsList = null
    if (!pid) return
    cleanupSpecsList = subscribeSpecsList(pid, () => {
      void refetch()
    })
  })

  onMount(() => {
    const unsub = subscribeProjectsList(() => {
      void (async () => {
        const previousMainId = current()?.worktree?.mainProjectId ?? null
        await refetchProjects()
        const pid = projectId()
        if (!pid) return
        const stillExists = (projects() ?? []).some((p) => p.id === pid)
        if (stillExists) return
        if (previousMainId) navigate(`/${encodeURIComponent(previousMainId)}`)
      })()
    })
    onCleanup(unsub)
  })

  onCleanup(() => {
    cleanupSpecsList?.()
    cleanupSpecsList = null
  })

  async function onMerge() {
    const cur = current()
    if (!cur?.worktree) return
    if (!mainReachable()) return
    const defaultMsg = `feat(${cur.worktree.branch}): merge from worktree`
    const msg = window.prompt(t('home.mergeHint'), defaultMsg)
    if (msg == null) return
    const message = msg.trim() || defaultMsg
    setMerging(true)
    setMergeError(null)
    try {
      const result = await api.mergeWorktreeToMain(cur.id, { commitMessage: message })
      if (result.status === 'merged') {
        toast.success(t('home.merged'))
        await refetchProjects()
        navigate(`/${encodeURIComponent(result.mainProjectId)}`)
      } else {
        toast.info(t('home.conflictDispatched'))
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
      await refetch()
    } catch (err) {
      setDeleteError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section class="overflow-y-auto p-2">
      <header class="flex items-center justify-between">
        <h1 class="m-0 text-xl">{t('home.specList')}</h1>
        <FocusModeButton />
      </header>

      <Show when={current()?.worktree}>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <span class=" text-muted-foreground">
              {t('home.mainProject')}
              {current()!.worktree!.mainPath.split('/').filter(Boolean).pop() ??
                current()!.worktree!.mainPath}
            </span>
          </div>
          <Button
            variant="default"
            size="sm"
            onClick={() => void onMerge()}
            disabled={merging() || !mainReachable()}
            title={mainReachable() ? t('home.mergeHint') : t('home.mainUnreachable')}
          >
            <GitMerge class="mr-1 h-3.5 w-3.5" />
            {merging() ? t('home.merging') : t('home.mergeToMain')}
          </Button>
          <Show when={!mainReachable()}>
            <span class=" text-muted-foreground">{t('home.mainUnreachable')}</span>
          </Show>
          <Show when={mergeError()}>
            <span class=" text-destructive">{mergeError()}</span>
          </Show>
        </div>
      </Show>

      <Suspense fallback={<p class=" text-muted-foreground">{t('common.loading')}</p>}>
        <Show
          when={(specs() ?? []).length > 0}
          fallback={
            <div class="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card p-12">
              <p>{t('home.noSpecs')}</p>
              <Button as={A} href={projectHref('specs/new')} variant="default" size="sm">
                <Plus class="mr-1 h-4 w-4" />
                {t('home.createFirst')}
              </Button>
            </div>
          }
        >
          <ul class="mt-4 grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr))]">
            <For each={specs() ?? []}>
              {(spec) => (
                <li class="group relative rounded-xl border bg-card shadow transition-transform hover:-translate-y-px">
                  <A href={projectHref(`specs/${encodeURIComponent(spec.id)}`)} class="block p-4">
                    <div class="flex items-center justify-between text-sm text-muted-foreground">
                      <Badge
                        class={`border-transparent ${STAGE_BG[spec.stage] ?? 'bg-muted'} text-white uppercase`}
                      >
                        {spec.stage}
                      </Badge>
                      <time>{formatSpecUpdatedAt(spec.updated_at)}</time>
                    </div>
                    <h2 class="my-1.5 text-base font-semibold">
                      {spec.title || t('common.pendingAgent')}
                    </h2>
                    <p class="m-0 mb-2 text-muted-foreground">
                      {spec.summary || t('common.pendingAgent')}
                    </p>
                    <code class="font-mono text-sm text-muted-foreground">{spec.id}</code>
                  </A>

                  <div class="absolute right-1.5 top-1.5 z-[2] opacity-0 transition-opacity group-hover:opacity-100">
                    <DropdownMenu placement="bottom-end">
                      <DropdownMenuTrigger
                        as={Button}
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7"
                        title={t('home.moreActions')}
                      >
                        <MoreHorizontal class="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          class="text-destructive focus:text-destructive"
                          onSelect={() => setConfirmDeleteId(spec.id)}
                        >
                          {t('common.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Suspense>

      <Dialog
        open={confirmDeleteId() !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmDeleteId(null)
            setDeleteError(null)
          }
        }}
      >
        <DialogContent class="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('home.confirmDeleteSpec')}</DialogTitle>
          </DialogHeader>
          <Show when={deleteError()}>
            <p class=" text-destructive">{deleteError()}</p>
          </Show>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteId(null)}
              disabled={deleting()}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId() && void onDeleteSpec(confirmDeleteId()!)}
              disabled={deleting()}
            >
              {deleting() ? t('common.deleting') : t('common.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
