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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog.jsx'
import { Input } from '../components/ui/input.jsx'
import { toast } from '../components/ui/sonner.jsx'
import { t } from '../i18n/index.js'

const STAGE_BG: Record<string, string> = {
  plan: 'bg-stage-plan',
  tasks: 'bg-stage-tasks',
  execute: 'bg-stage-execute',
  done: 'bg-stage-done',
}

const SPEC_TYPE_TEXT: Record<string, string> = {
  feat: 'text-emerald-600 dark:text-emerald-400',
  refct: 'text-sky-600 dark:text-sky-400',
  fix: 'text-rose-600 dark:text-rose-400',
}

function splitSpecId(id: string): { prefix: string; type: string; suffix: string } | null {
  const [prefix, type, ...rest] = id.split('.')
  if (!prefix || !type || rest.length === 0) return null
  return { prefix, type, suffix: rest.join('.') }
}

export const SpecList: Component = () => {
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
  const defaultMergeMessage = createMemo(() => {
    const cur = current()
    return cur?.worktree ? `feat(${cur.worktree.branch}): merge from worktree` : ''
  })

  const [merging, setMerging] = createSignal(false)
  const [mergeError, setMergeError] = createSignal<string | null>(null)
  const [mergeDialogOpen, setMergeDialogOpen] = createSignal(false)
  const [mergeMessage, setMergeMessage] = createSignal('')
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal(false)
  const [deleteError, setDeleteError] = createSignal<string | null>(null)
  useFocusModePage(() => mergeDialogOpen() || confirmDeleteId() !== null)

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

  function openMergeDialog() {
    const cur = current()
    if (!cur?.worktree) return
    if (!mainReachable()) return
    setMergeMessage(defaultMergeMessage())
    setMergeError(null)
    setMergeDialogOpen(true)
  }

  async function onMerge() {
    const cur = current()
    if (!cur?.worktree) return
    if (!mainReachable()) return
    const message = mergeMessage().trim() || defaultMergeMessage()
    setMerging(true)
    setMergeError(null)
    try {
      const result = await api.mergeWorktreeToMain(cur.id, { commitMessage: message })
      setMergeDialogOpen(false)
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
            onClick={openMergeDialog}
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
              {(spec) => {
                const idParts = splitSpecId(spec.id)
                return (
                  <li class="group relative flex rounded-xl border bg-card shadow transition-transform hover:-translate-y-px">
                    <A
                      href={projectHref(`specs/${encodeURIComponent(spec.id)}`)}
                      class="flex min-h-40 flex-1 flex-col p-4"
                    >
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
                      <p class="m-0 mb-3 flex-1 text-muted-foreground">
                        {spec.summary || t('common.pendingAgent')}
                      </p>
                      <code class="mt-auto block break-all font-mono text-sm text-muted-foreground">
                        <Show when={idParts} fallback={spec.id}>
                          {(parts) => (
                            <>
                              <span>{parts().prefix}.</span>
                              <span
                                class={`font-semibold ${SPEC_TYPE_TEXT[parts().type] ?? 'text-foreground'}`}
                              >
                                {parts().type}
                              </span>
                              <span>.{parts().suffix}</span>
                            </>
                          )}
                        </Show>
                      </code>
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
                )
              }}
            </For>
          </ul>
        </Show>
      </Suspense>

      <Dialog
        open={mergeDialogOpen()}
        onOpenChange={(o) => {
          setMergeDialogOpen(o)
          if (!o) setMergeError(null)
        }}
      >
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('home.mergeDialogTitle')}</DialogTitle>
            <DialogDescription>{t('home.mergeDialogDescription')}</DialogDescription>
          </DialogHeader>
          <form
            class="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void onMerge()
            }}
          >
            <label class="grid gap-2 text-sm font-medium" for="merge-commit-message">
              {t('home.mergeCommitMessage')}
              <Input
                id="merge-commit-message"
                value={mergeMessage()}
                onInput={(e) => setMergeMessage(e.currentTarget.value)}
                disabled={merging()}
              />
            </label>
            <Show when={mergeError()}>
              <p class=" text-destructive">{mergeError()}</p>
            </Show>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMergeDialogOpen(false)}
                disabled={merging()}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={merging() || !mainReachable()}>
                {merging() ? t('home.merging') : t('home.mergeToMain')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
