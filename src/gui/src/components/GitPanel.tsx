import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js'
import { GitBranch, Loader2 } from 'lucide-solid'
import { api, type GitOpsAction, type GitChange } from '../lib/api.js'
import { requestChatSession } from '../lib/project.js'
import { subscribeProjectChanges, subscribeSession } from '../lib/sse.js'
import { Button } from './ui/button.jsx'
import { Textarea } from './ui/textarea.jsx'
import { Input } from './ui/input.jsx'
import { Checkbox, CheckboxControl } from './ui/checkbox.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx'
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
} from './ui/radio-group.jsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.jsx'
import { DiffView } from './DiffView.jsx'
import { toast } from './ui/toast.jsx'
import { t } from '../i18n/index.js'

type FileSelectMode = 'manual' | 'agent'
/** Repo-wide actions (push/pull) never take a file selection. */
type GitAction = 'commit' | 'discard' | 'push' | 'pull' | 'checkout'

export interface GitPanelProps {
  projectId: () => string
  /** Present ⇒ spec context: enables the Agent-dispatch mode. */
  specId?: () => string | undefined
  /** Prefilled commit message (spec entry passes `${type}: ${summary}`). */
  initialMessage?: () => string
}

// git 文件状态 → 语义 token。裸调色板类在暗色下几乎不可读，必须走语义色。
const STATUS_COLOR: Record<string, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-destructive',
  '??': 'text-info',
  R: 'text-primary',
}

/**
 * Shared git working-tree panel used by both the standalone Git page and the
 * spec Review page. Without a `specId` the Agent-dispatch mode is not rendered
 * at all — it needs a spec session to dispatch to.
 */
export const GitPanel: Component<GitPanelProps> = (props) => {
  const [changes, setChanges] = createSignal<GitChange[]>([])
  const [fileSelectMode, setFileSelectMode] = createSignal<FileSelectMode>('manual')
  const [selectedPaths, setSelectedPaths] = createSignal<Set<string>>(new Set())
  const [activePath, setActivePath] = createSignal<string | null>(null)
  const [commitMessage, setCommitMessage] = createSignal('')
  const [userEditedMsg, setUserEditedMsg] = createSignal(false)
  const [directAction, setDirectAction] = createSignal<GitAction | null>(null)
  const [branchQuery, setBranchQuery] = createSignal('')

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

  const specId = (): string | undefined => props.specId?.()
  const hasSpec = createMemo(() => Boolean(specId()))

  let commitMsgRef: HTMLTextAreaElement | undefined
  let roundUnsub: (() => void) | null = null
  onCleanup(() => roundUnsub?.())
  // Never leave a caller awaiting a dialog that unmounted with the page.
  onCleanup(() => resolveConfirm(false))

  function autoResize(el: HTMLTextAreaElement | undefined): void {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  createEffect(() => {
    const msg = props.initialMessage?.() ?? ''
    if (msg && !userEditedMsg()) setCommitMessage(msg)
  })

  createEffect(
    on(commitMessage, () => {
      autoResize(commitMsgRef)
    }),
  )

  onMount(() => autoResize(commitMsgRef))

  const [branchState, { refetch: refetchBranches, mutate: mutateBranchState }] = createResource(
    props.projectId,
    (pid) => api.getGitBranches(pid),
  )

  const filteredBranches = createMemo(() => {
    const query = branchQuery().trim().toLowerCase()
    const branches = branchState()?.branches ?? []
    if (!query) return branches
    return branches.filter((branch) => branch.toLowerCase().includes(query))
  })

  createEffect(() => {
    const pid = props.projectId()
    if (!pid) return
    const unsub = subscribeProjectChanges(pid, (newChanges) => {
      setChanges(newChanges)
      const validPaths = new Set(newChanges.map((c) => c.path))
      setSelectedPaths((prev) => {
        const next = new Set<string>()
        for (const p of prev) if (validPaths.has(p)) next.add(p)
        return next
      })
      const active = activePath()
      if (active && !validPaths.has(active)) setActivePath(null)
    })
    onCleanup(() => unsub())
  })

  // Re-fetch the preview whenever the file list changes: a commit or discard
  // rewrites the very diff being shown.
  const [diff] = createResource(
    () => {
      const path = activePath()
      const pid = props.projectId()
      if (!path || !pid) return null
      const entry = changes().find((c) => c.path === path)
      return { pid, path, revision: `${entry?.index ?? ''}${entry?.worktree ?? ''}` }
    },
    (key) => api.getFileDiff(key.pid, key.path),
  )

  function isKindRunning(kind: GitOpsAction): boolean {
    return agentKind() === kind
  }
  const isAnyRunning = createMemo(
    () => busy() !== null || agentKind() !== null || directAction() !== null,
  )
  const visibleError = createMemo(
    () => error() ?? (branchState.error ? (branchState.error as Error).message : null),
  )

  // Track a dispatched agent round on the spec session and clear the running
  // kind when the turn completes.
  function trackRound(kind: GitOpsAction, sessionId: string): void {
    roundUnsub?.()
    setAgentKind(kind)
    roundUnsub = subscribeSession(props.projectId(), sessionId, {
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

  async function triggerDirect(kind: 'commit' | 'discard'): Promise<void> {
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
        await api.projectCommit(props.projectId(), { message, paths })
      } else {
        await api.projectDiscard(props.projectId(), { paths })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDirectAction(null)
    }
  }

  async function triggerAgent(kind: GitOpsAction): Promise<void> {
    const id = specId()
    if (!id || isAnyRunning()) return
    setError(null)
    if (kind === 'discard') {
      const ok = await askDiscard(t('review.confirmDiscardAll'))
      if (!ok) return
    }
    setBusy(kind)
    try {
      const res = await api.gitOp(props.projectId(), id, kind)
      setLastRun({ kind, runId: res.runId })
      requestChatSession(res.sessionId)
      trackRound(kind, res.sessionId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function triggerGit(kind: 'commit' | 'discard'): Promise<void> {
    if (fileSelectMode() === 'manual') await triggerDirect(kind)
    else await triggerAgent(kind)
  }

  /** Push and pull act on the whole repository, never on the file selection. */
  async function triggerRemote(kind: 'push' | 'pull'): Promise<void> {
    if (isAnyRunning()) return
    setError(null)
    setDirectAction(kind)
    try {
      if (kind === 'push') {
        const res = await api.projectPush(props.projectId())
        toast.success(t('git.pushed', { branch: res.branch }))
      } else {
        const res = await api.projectPull(props.projectId())
        toast.success(res.updated ? t('git.pulled', { branch: res.branch }) : t('git.upToDate'))
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDirectAction(null)
    }
  }

  async function triggerBranchCheckout(branch: string | null): Promise<void> {
    const target = branch?.trim()
    const pid = props.projectId()
    if (!target || !pid || isAnyRunning()) return
    if (target === branchState()?.current) return

    setError(null)
    setDirectAction('checkout')
    try {
      const res = await api.checkoutGitBranch(pid, target)
      mutateBranchState((prev) => ({
        current: res.current,
        branches: prev?.branches.includes(res.current)
          ? prev.branches
          : [...(prev?.branches ?? []), res.current].sort(),
      }))
      setSelectedPaths(new Set<string>())
      setActivePath(null)
      setBranchQuery('')
      const changesResult = await api.getProjectChanges(pid)
      setChanges(changesResult.changes)
      await refetchBranches()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDirectAction(null)
    }
  }

  function buttonLoading(kind: GitAction): boolean {
    return (
      directAction() === kind ||
      (kind !== 'push' &&
        kind !== 'pull' &&
        kind !== 'checkout' &&
        (isKindRunning(kind) || busy() === kind))
    )
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

  // An empty message must never reach the server: the standalone entry starts
  // blank, and a blank commit is rejected there anyway.
  const commitDisabled = createMemo(
    () =>
      isAnyRunning() ||
      (fileSelectMode() === 'manual' && (manualNoSelection() || commitMessage().trim() === '')),
  )

  return (
    <div class="flex min-h-0 flex-1 gap-4">
      <section
        data-testid="review-controls-pane"
        class="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <Select<string>
            options={filteredBranches()}
            value={branchState()?.current ?? null}
            onChange={(branch) => void triggerBranchCheckout(branch)}
            optionValue={(branch) => branch}
            optionTextValue={(branch) => branch}
            disabled={isAnyRunning() || branchState.loading || Boolean(branchState.error)}
            placeholder={t('git.branchPlaceholder')}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>
                <span class="truncate font-mono text-sm">{itemProps.item.rawValue}</span>
              </SelectItem>
            )}
          >
            <SelectTrigger
              class="h-8 w-56 max-w-full gap-2 px-2 text-sm"
              title={t('git.branchSelect')}
              aria-label={t('git.branchSelect')}
            >
              <Show
                when={!branchState.loading && directAction() !== 'checkout'}
                fallback={<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin" />}
              >
                <GitBranch class="h-3.5 w-3.5 shrink-0" />
              </Show>
              <span class="min-w-0 flex-1 truncate text-left font-mono">
                <SelectValue<string>>
                  {(state) => state.selectedOption() ?? t('git.branchPlaceholder')}
                </SelectValue>
              </span>
            </SelectTrigger>
            <SelectContent class="w-64">
              <div class="border-b p-1">
                <Input
                  value={branchQuery()}
                  onInput={(e) => setBranchQuery(e.currentTarget.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder={t('git.branchFilterPlaceholder')}
                  class="h-8 text-sm"
                />
              </div>
              <Show when={!branchState.loading && filteredBranches().length === 0}>
                <div class="px-2 py-2 text-sm text-muted-foreground">{t('git.noBranches')}</div>
              </Show>
            </SelectContent>
          </Select>
          <Button
            variant="default"
            size="sm"
            disabled={commitDisabled()}
            onClick={() => triggerGit('commit')}
          >
            <Show when={buttonLoading('commit')}>
              <Loader2 class="mr-1 h-3 w-3 animate-spin" />
            </Show>
            {buttonLoading('commit') ? t('review.committing') : t('review.commit')}
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
            {buttonLoading('discard') ? t('review.discarding') : t('review.discard')}
          </Button>
          <span aria-hidden="true" class="select-none text-border">
            |
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={isAnyRunning()}
            onClick={() => void triggerRemote('push')}
          >
            <Show when={buttonLoading('push')}>
              <Loader2 class="mr-1 h-3 w-3 animate-spin" />
            </Show>
            {buttonLoading('push') ? t('git.pushing') : t('git.push')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={isAnyRunning()}
            onClick={() => void triggerRemote('pull')}
          >
            <Show when={buttonLoading('pull')}>
              <Loader2 class="mr-1 h-3 w-3 animate-spin" />
            </Show>
            {buttonLoading('pull') ? t('git.pulling') : t('git.pull')}
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

        <Show when={hasSpec()}>
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
        </Show>

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
                <div
                  class={`flex items-center gap-2 px-2 py-0.5 ${
                    activePath() === change.path ? 'bg-accent' : ''
                  }`}
                >
                  {/* 勾选＝操作范围，点击文件名＝预览 diff，两者互不影响 */}
                  <Checkbox
                    checked={selectedPaths().has(change.path)}
                    onChange={() => togglePath(change.path)}
                    disabled={isAnyRunning()}
                  >
                    <CheckboxControl />
                  </Checkbox>
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
                    onClick={() => setActivePath(change.path)}
                    title={change.path}
                  >
                    <span
                      class={`inline-block w-6 text-center text-sm font-bold ${STATUS_COLOR[change.status] ?? ''}`}
                    >
                      {change.status}
                    </span>
                    <span class="truncate font-mono text-sm">{change.path}</span>
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={fileSelectMode() === 'manual' && changes().length === 0}>
          <p class=" text-muted-foreground">{t('review.noChanges')}</p>
        </Show>

        <Show when={visibleError()}>
          <p class="text-destructive ">{visibleError()}</p>
        </Show>
        <Show when={lastRun()}>
          <p class=" text-muted-foreground">
            {t('review.dispatched')}
            {lastRun()!.kind === 'commit' ? t('review.commit') : t('review.discard')}
            （runId: <code>{lastRun()!.runId.slice(0, 8)}</code>）
          </p>
        </Show>
      </section>

      <Show when={activePath()}>
        {(path) => (
          <DiffView
            path={path()}
            patch={diff()?.patch ?? ''}
            binary={diff()?.binary ?? false}
            truncated={diff()?.truncated ?? false}
            loading={diff.loading}
            error={diff.error ? (diff.error as Error).message : null}
          />
        )}
      </Show>

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
    </div>
  )
}
