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
import { useParams } from '@solidjs/router'
import { Loader2 } from 'lucide-solid'
import { api, type GitOpsAction, type GitChange } from '../lib/api.js'
import { projectHref, requestChatSession, useCurrentProjectId } from '../lib/project.js'
import { useFocusModePage } from '../lib/layout-focus.js'
import { subscribeChanges, subscribeSession } from '../lib/sse.js'
import { Button } from '../components/ui/button.jsx'
import { Textarea } from '../components/ui/textarea.jsx'
import { Checkbox, CheckboxControl, CheckboxLabel } from '../components/ui/checkbox.jsx'
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
} from '../components/ui/radio-group.jsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.jsx'
import { Breadcrumb } from '../components/Breadcrumb.jsx'
import { FocusModeButton } from '../components/FocusModeButton.jsx'
import { t } from '../i18n/index.js'

type FileSelectMode = 'manual' | 'agent'

const ACTION_LABEL_KEY: Record<GitOpsAction, string> = {
  commit: 'review.commit',
  discard: 'review.discard',
  stash: 'review.stash',
}

const LOADING_LABEL_KEY: Record<GitOpsAction, string> = {
  commit: 'review.committing',
  discard: 'review.discarding',
  stash: 'review.stashing',
}

const IDLE_LABEL_KEY: Record<GitOpsAction, string> = {
  commit: 'review.commit',
  discard: 'review.discard',
  stash: 'review.stash',
}

// git 文件状态 → 语义 token。原先是裸调色板类且无 dark: 变体，暗色下几乎不可读。
const STATUS_COLOR: Record<string, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-destructive',
  '??': 'text-info',
  R: 'text-primary',
}

export const SpecReview: Component = () => {
  const params = useParams<{ id: string }>()
  const projectId = useCurrentProjectId()
  const [spec] = createResource(
    () => [projectId(), params.id] as const,
    ([pid, id]) => api.getSpec(pid, id),
  )
  const [changes, setChanges] = createSignal<GitChange[]>([])
  const [fileSelectMode, setFileSelectMode] = createSignal<FileSelectMode>('manual')
  const [selectedPaths, setSelectedPaths] = createSignal<Set<string>>(new Set())
  const [commitMessage, setCommitMessage] = createSignal('')
  const [userEditedMsg, setUserEditedMsg] = createSignal(false)
  const [directAction, setDirectAction] = createSignal<GitOpsAction | null>(null)

  const [busy, setBusy] = createSignal<GitOpsAction | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [lastRun, setLastRun] = createSignal<{ kind: GitOpsAction; runId: string } | null>(null)
  const [agentKind, setAgentKind] = createSignal<GitOpsAction | null>(null)

  // Promise-based confirm dialog: `askDiscard` opens the modal and resolves once
  // the user picks. The prompt text lives in its own signal so it stays rendered
  // through the dialog's close animation.
  const [discardPrompt, setDiscardPrompt] = createSignal('')
  const [pendingConfirm, setPendingConfirm] = createSignal<((ok: boolean) => void) | null>(null)

  function askDiscard(message: string): Promise<boolean> {
    setDiscardPrompt(message)
    return new Promise((resolve) => setPendingConfirm(() => resolve))
  }

  function resolveConfirm(ok: boolean): void {
    const resolve = pendingConfirm()
    if (!resolve) return
    setPendingConfirm(null)
    resolve(ok)
  }

  let commitMsgRef: HTMLTextAreaElement | undefined
  let roundUnsub: (() => void) | null = null
  onCleanup(() => roundUnsub?.())
  // Never leave a caller awaiting a dialog that unmounted with the page.
  onCleanup(() => resolveConfirm(false))
  useFocusModePage()

  function autoResize(el: HTMLTextAreaElement | undefined): void {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
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

  function isKindRunning(kind: GitOpsAction): boolean {
    return agentKind() === kind
  }
  const runningKind = createMemo<GitOpsAction | null>(() => agentKind())
  const isAnyRunning = createMemo(
    () => busy() !== null || runningKind() !== null || directAction() !== null,
  )

  // Track a dispatched agent round on the spec session and clear the running
  // kind when the turn completes.
  function trackRound(kind: GitOpsAction, sessionId: string): void {
    roundUnsub?.()
    setAgentKind(kind)
    roundUnsub = subscribeSession(projectId(), sessionId, {
      onEvent: (ev) => {
        if (ev.type === 'turn-completed' || ev.type === 'error') {
          setAgentKind(null)
          roundUnsub?.()
          roundUnsub = null
        }
      },
    })
  }

  function getPaths(): string[] {
    if (fileSelectMode() === 'agent') return changes().map((c) => c.path)
    return [...selectedPaths()]
  }

  async function triggerDirect(kind: GitOpsAction): Promise<void> {
    if (isAnyRunning()) return
    setError(null)
    const paths = getPaths()
    if (paths.length === 0) {
      setError(t('review.selectAtLeastOne'))
      return
    }
    if (kind === 'discard') {
      const ok = await askDiscard(t('review.confirmDiscard'))
      if (!ok) return
    }
    setDirectAction(kind)
    try {
      if (kind === 'commit') {
        const message = commitMessage().trim()
        if (!message) {
          setError(t('review.enterCommitMsg'))
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

  async function triggerAgent(kind: GitOpsAction): Promise<void> {
    if (isAnyRunning()) return
    setError(null)
    if (kind === 'discard') {
      const ok = await askDiscard(t('review.confirmDiscardAll'))
      if (!ok) return
    }
    setBusy(kind)
    try {
      const res = await api.gitOp(projectId(), params.id, kind)
      setLastRun({ kind, runId: res.runId })
      requestChatSession(res.sessionId)
      trackRound(kind, res.sessionId)
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

  function buttonLoading(kind: GitOpsAction): boolean {
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
    <section class="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <Suspense fallback={<p class="text-muted-foreground">{t('common.loading')}</p>}>
        <header class="flex items-start justify-between gap-2">
          <div class="flex flex-col gap-1">
            <Breadcrumb
              items={[
                { label: t('breadcrumb.specList'), href: projectHref('') },
                { label: params.id, href: projectHref(`specs/${params.id}`) },
                { label: t('specDetail.review') },
              ]}
            />
            <p class=" text-muted-foreground">
              {spec()?.frontmatter.summary || t('common.pendingAgent')}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2 text-muted-foreground">
            <FocusModeButton />
          </div>
        </header>

        <div class="flex min-h-0 flex-1 gap-4">
          <section
            data-testid="review-controls-pane"
            class="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <Button
                variant="default"
                size="sm"
                disabled={isAnyRunning() || manualNoSelection()}
                onClick={() => triggerGit('commit')}
              >
                <Show when={buttonLoading('commit')}>
                  <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                </Show>
                {buttonLoading('commit') ? t(LOADING_LABEL_KEY.commit) : t(IDLE_LABEL_KEY.commit)}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="text-destructive"
                disabled={isAnyRunning() || manualNoSelection()}
                onClick={() => triggerGit('discard')}
              >
                <Show when={buttonLoading('discard')}>
                  <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                </Show>
                {buttonLoading('discard')
                  ? t(LOADING_LABEL_KEY.discard)
                  : t(IDLE_LABEL_KEY.discard)}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isAnyRunning() || manualNoSelection()}
                onClick={() => triggerGit('stash')}
              >
                <Show when={buttonLoading('stash')}>
                  <Loader2 class="mr-1 h-3 w-3 animate-spin" />
                </Show>
                {buttonLoading('stash') ? t(LOADING_LABEL_KEY.stash) : t(IDLE_LABEL_KEY.stash)}
              </Button>
            </div>

            <Textarea
              ref={commitMsgRef}
              placeholder={t('review.commitPlaceholder')}
              value={commitMessage()}
              onInput={(e) => {
                setUserEditedMsg(true)
                setCommitMessage(e.currentTarget.value)
                autoResize(commitMsgRef)
              }}
              disabled={isAnyRunning()}
              rows={2}
              class="resize-none"
            />

            <RadioGroup
              class="flex gap-4"
              value={fileSelectMode()}
              onChange={(v) => setFileSelectMode(v as FileSelectMode)}
              disabled={isAnyRunning()}
            >
              <RadioGroupItem value="manual" class="flex items-center gap-1.5">
                <RadioGroupItemInput />
                <RadioGroupItemControl />
                <RadioGroupItemLabel class="cursor-pointer">
                  {t('review.manualSelect')}
                </RadioGroupItemLabel>
              </RadioGroupItem>
              <RadioGroupItem value="agent" class="flex items-center gap-1.5">
                <RadioGroupItemInput />
                <RadioGroupItemControl />
                <RadioGroupItemLabel class="cursor-pointer">
                  {t('review.agentSelect')}
                </RadioGroupItemLabel>
              </RadioGroupItem>
            </RadioGroup>

            <Show when={fileSelectMode() === 'manual' && changes().length > 0}>
              <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-auto rounded-xl border">
                <div class="sticky top-0 flex items-center gap-2 border-b bg-card px-2 py-1">
                  <Button variant="ghost" size="sm" onClick={toggleAll} disabled={isAnyRunning()}>
                    {allSelected() ? t('review.deselectAll') : t('review.selectAll')}
                  </Button>
                  <span class=" text-muted-foreground">
                    {t('review.fileCount', {
                      selected: selectedPaths().size,
                      total: changes().length,
                    })}
                  </span>
                </div>
                <For each={changes()}>
                  {(change) => (
                    <Checkbox
                      class="flex items-center gap-2 px-2 py-0.5"
                      checked={selectedPaths().has(change.path)}
                      onChange={() => togglePath(change.path)}
                      disabled={isAnyRunning()}
                    >
                      <CheckboxControl />
                      <CheckboxLabel class="flex min-w-0 cursor-pointer items-center gap-2">
                        <span
                          class={`inline-block w-6 text-center text-sm font-bold ${STATUS_COLOR[change.status] ?? ''}`}
                        >
                          {change.status}
                        </span>
                        <span class="truncate font-mono text-sm">{change.path}</span>
                      </CheckboxLabel>
                    </Checkbox>
                  )}
                </For>
              </div>
            </Show>
            <Show when={fileSelectMode() === 'manual' && changes().length === 0}>
              <p class=" text-muted-foreground">{t('review.noChanges')}</p>
            </Show>

            <Show when={error()}>
              <p class="text-destructive ">{error()}</p>
            </Show>
            <Show when={lastRun()}>
              <p class=" text-muted-foreground">
                {t('review.dispatched')}
                {t(ACTION_LABEL_KEY[lastRun()!.kind])}
                （runId: <code>{lastRun()!.runId.slice(0, 8)}</code>）
              </p>
            </Show>
          </section>
        </div>
      </Suspense>

      <Dialog
        open={pendingConfirm() !== null}
        onOpenChange={(open) => {
          if (!open) resolveConfirm(false)
        }}
      >
        <DialogContent class="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('review.discardTitle')}</DialogTitle>
            <DialogDescription>{discardPrompt()}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => resolveConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => resolveConfirm(true)}>
              {t('review.confirmDiscardAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
