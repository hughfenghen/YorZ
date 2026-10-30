import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Check, GitBranch, MoreHorizontal } from 'lucide-solid'
import { api, type GitChange, type GitOpsAction } from '@shared/api/index.js'
import { subscribeProjectChanges, subscribeSession } from '@shared/api/sse.js'
import { diffRevision, reconcileSelection } from '@shared/lib/git-changes.js'
import { Page } from '@/components/Page.jsx'
import { Sheet } from '@/components/Sheet.jsx'
import { ActionSheet, type ActionSheetItem } from '@/components/ActionSheet.jsx'
import { NoProjectNotice, Notice } from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import { GitDiffView } from '@/components/GitDiffView.jsx'
import { GitFileList } from '@/components/GitFileList.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { autoSizeTextarea } from '@/lib/autosize.js'
import { cn } from '@/lib/cn'
import { t } from '@/i18n/index.js'

/** 提交信息与会话输入框同口径：1 行起、最多 5 行。 */
const COMMIT_MAX_ROWS = 5

/** 六个 direct 动作共用一个闸：任一在飞，其余全部禁用。 */
type GitAction = 'commit' | 'discard' | 'push' | 'pull' | 'checkout' | 'merge'

/** commit / discard 的执行主体：自己调 REST，还是派给 spec 的 agent。 */
type FileSelectMode = 'manual' | 'agent'

export interface GitPanelProps {
  /** 顶栏标题，两个入口各自给（扩展页给 git.title，spec 页给 spec id）。 */
  title: string
  /** 返回目标显式给出，不用 history.back()（PWA 冷启二级页会退出应用）。 */
  onBack: () => void
  /** 存在 ⇒ spec 上下文，开启 Agent 派发模式。 */
  specId?: () => string | undefined
  /** 预填 commit message；用户敲过键盘后就不再覆盖（见下方采纳闸）。 */
  initialMessage?: () => string
  /** 扩展页传入；spec Git 页不展示历史入口。 */
  onOpenHistory?: () => void
}

/**
 * 移动端 Git 工作区面板，被扩展页入口与 spec 作用域入口共用——与桌面端
 * `GitPanel` + `GitStatus`(壳) + `SpecReview`(壳) 的结构同构。
 *
 * 与桌面端 GitPanel 的差别只有两处，其余语义逐项对齐：
 * 1. **垂直排列**而不是左右分栏——变更列表在上、diff 预览在下，同屏可见。
 * 2. `ActionSheet` / `Sheet` 替代 Kobalte 的 Select / Popover / Dialog 浮层。
 *
 * `projectId` 刻意**不进 props**：移动端是 `activeProjectId()` 全局单选模型，
 * 两个入口拿到的项目必然相同，多一个 props 只会制造「两个真相」。
 */
export const GitPanel: Component<GitPanelProps> = (props) => {
  const [changes, setChanges] = createSignal<GitChange[]>([])
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  const [activePath, setActivePath] = createSignal<string | null>(null)
  const [message, setMessage] = createSignal('')
  const [userEditedMsg, setUserEditedMsg] = createSignal(false)
  const [busy, setBusy] = createSignal<GitAction | null>(null)
  const [mode, setMode] = createSignal<FileSelectMode>('manual')
  /** agent 轮次在飞时非 null；由 SSE 的 turn-completed / error 落回。 */
  const [agentKind, setAgentKind] = createSignal<GitOpsAction | null>(null)

  const [branchSheet, setBranchSheet] = createSignal(false)
  const [mergeSheet, setMergeSheet] = createSignal(false)
  const [branchQuery, setBranchQuery] = createSignal('')
  const [mergeQuery, setMergeQuery] = createSignal('')
  const [mergeTarget, setMergeTarget] = createSignal<string | null>(null)
  const [moreOpen, setMoreOpen] = createSignal(false)
  const [confirmingDiscard, setConfirmingDiscard] = createSignal(false)
  const [messageEl, setMessageEl] = createSignal<HTMLTextAreaElement>()

  const projectId = () => activeProjectId() ?? undefined
  const specId = (): string | undefined => props.specId?.()
  const hasSpec = createMemo(() => Boolean(specId()))

  /**
   * 合并闸。direct 动作由 `await` 收尾，agent 轮次却由 SSE 收尾——两者
   * 必须共用一个「有事在飞」的判定，否则派发出去的轮次挡不住紧接着的直改。
   */
  const anyRunning = createMemo(() => busy() !== null || agentKind() !== null)

  let roundUnsub: (() => void) | null = null
  onCleanup(() => roundUnsub?.())

  /**
   * 预填采纳闸：spec resource 异步 resolve 后才回填，所以只要用户已经敲过
   * 键盘就永不覆盖——否则会把他写了一半的信息冲掉。
   */
  createEffect(() => {
    const msg = props.initialMessage?.() ?? ''
    if (msg && !userEditedMsg()) setMessage(msg)
  })

  /**
   * 提交框高度跟着 `message()` 走，与会话输入框同一套自增高（最多 5 行）。
   * 挂 effect 而不是只挂 onInput：预填回写与提交成功后的清空都不产生 input
   * 事件，只靠 onInput 的话高度会停在上一次的行数上。
   * 元素用信号持有：切到 agent 模式时这个 textarea 会被卸载，重新挂载后
   * 必须让 effect 认得到新节点。
   */
  createEffect(() => {
    message()
    const el = messageEl()
    if (el?.isConnected) autoSizeTextarea(el, COMMIT_MAX_ROWS)
  })

  const [branchState, { refetch: refetchBranches, mutate: mutateBranchState }] = createResource(
    projectId,
    (pid) => api.getGitBranches(pid),
  )

  /** 采纳一份新的变更列表，并丢掉它作废的勾选与预览。 */
  function applyChanges(next: GitChange[]): void {
    setChanges(next)
    const kept = reconcileSelection(selected(), activePath(), next)
    setSelected(kept.selected)
    setActivePath(kept.active)
  }

  createEffect(() => {
    const pid = projectId()
    if (!pid) return
    let disposed = false
    // 服务端只在首次 attach topic 时 emit 一次快照，且会跳过已订阅的 topic：
    // 快进快出会被 debounce 合并成一次 topic 集合不变的 subscribe，重新挂载的
    // 页面于是拿不到快照，watcher 也要等工作区真的变了才出声。初始列表必须自己拉。
    let sawPush = false
    void api
      .getProjectChanges(pid)
      .then((res) => {
        // 已经落地的推送比这份快照新。
        if (disposed || sawPush) return
        applyChanges(res.changes)
      })
      .catch(() => {
        // 偶发失败：下一次推送仍会把列表修好。
      })
    const unsub = subscribeProjectChanges(pid, (next) => {
      sawPush = true
      applyChanges(next)
    })
    onCleanup(() => {
      disposed = true
      unsub()
    })
  })

  // key 里带 revision：提交或丢弃会重写正在看的那份 diff，状态一变就自动重取。
  const [diff] = createResource(
    () => {
      const path = activePath()
      const pid = projectId()
      if (!path || !pid) return null
      return {
        pid,
        path,
        revision: diffRevision(changes().find((c) => c.path === path)),
      }
    },
    (key) => api.getFileDiff(key.pid, key.path),
  )

  const filteredBranches = createMemo(() => {
    const query = branchQuery().trim().toLowerCase()
    const list = branchState()?.branches ?? []
    return query ? list.filter((b) => b.toLowerCase().includes(query)) : list
  })

  // 合并源包含本地 + 远程跟踪分支，本地在前——常见情况留在列表顶部。
  const filteredMergeCandidates = createMemo(() => {
    const state = branchState()
    const list = [...(state?.branches ?? []), ...(state?.remoteBranches ?? [])]
    const query = mergeQuery().trim().toLowerCase()
    return query ? list.filter((b) => b.toLowerCase().includes(query)) : list
  })

  const allSelected = createMemo(
    () => changes().length > 0 && changes().every((c) => selected().has(c.path)),
  )
  /** agent 模式下范围由 agent 自己定，勾选与提交信息都不再是前置条件。 */
  const canCommit = createMemo(() => {
    if (anyRunning()) return false
    if (mode() === 'agent') return true
    return selected().size > 0 && message().trim().length > 0
  })
  const canDiscard = createMemo(() => !anyRunning() && (mode() === 'agent' || selected().size > 0))

  function togglePath(path: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleAll(): void {
    setSelected(allSelected() ? new Set<string>() : new Set(changes().map((c) => c.path)))
  }

  /** 操作成功后主动重取，不等 SSE：服务端是 1s 轮询，窗口内重复点击会撞 400。 */
  async function refreshChanges(pid: string): Promise<void> {
    const res = await api.getProjectChanges(pid)
    applyChanges(res.changes)
  }

  async function run(action: GitAction, fn: (pid: string) => Promise<void>): Promise<void> {
    const pid = projectId()
    if (!pid || anyRunning()) return
    setBusy(action)
    try {
      await fn(pid)
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const navigate = useNavigate()

  /**
   * 派一个 agent 轮次，然后跳去会话详情看输出。
   *
   * 跳转后本页卸载、`onCleanup` 退订，所以 `agentKind` 实际只覆盖「派发中到
   * 跳转前」这一小段；但它仍必须存在——`gitOp` 失败时页面不跳，闸得自己落回。
   */
  async function triggerAgent(kind: GitOpsAction): Promise<void> {
    const pid = projectId()
    const id = specId()
    if (!pid || !id || anyRunning()) return
    setAgentKind(kind)
    try {
      const res = await api.gitOp(pid, id, kind)
      roundUnsub?.()
      roundUnsub = subscribeSession(pid, res.sessionId, {
        onEvent: (ev) => {
          if (ev.type === 'turn-completed' || ev.type === 'error') {
            setAgentKind(null)
            roundUnsub?.()
            roundUnsub = null
          }
        },
      })
      showToast(t('git.agentDispatched'))
      navigate(`/sessions/${encodeURIComponent(res.sessionId)}`)
    } catch (err) {
      setAgentKind(null)
      showToast((err as Error).message, 'error')
    }
  }

  const commit = () => {
    if (mode() === 'agent') return void triggerAgent('commit')
    return void run('commit', async (pid) => {
      const text = message().trim()
      if (selected().size === 0) return void showToast(t('git.selectAtLeastOne'), 'error')
      if (!text) return void showToast(t('git.enterCommitMsg'), 'error')
      await api.projectCommit(pid, { message: text, paths: [...selected()] })
      setSelected(new Set<string>())
      setActivePath(null)
      setMessage('')
      showToast(t('git.committed'))
      await refreshChanges(pid)
    })
  }

  const discard = () => {
    if (mode() === 'agent') return void triggerAgent('discard')
    return void run('discard', async (pid) => {
      if (selected().size === 0) return void showToast(t('git.selectAtLeastOne'), 'error')
      await api.projectDiscard(pid, { paths: [...selected()] })
      setSelected(new Set<string>())
      setActivePath(null)
      showToast(t('git.discarded'))
      await refreshChanges(pid)
    })
  }

  const push = () =>
    run('push', async (pid) => {
      const res = await api.projectPush(pid)
      showToast(t('git.pushed', { branch: res.branch }))
    })

  const pull = () =>
    run('pull', async (pid) => {
      const res = await api.projectPull(pid)
      showToast(res.updated ? t('git.pulled', { branch: res.branch }) : t('git.upToDate'))
      await refreshChanges(pid)
    })

  const checkout = (branch: string) =>
    run('checkout', async (pid) => {
      if (branch === branchState()?.current) return
      const res = await api.checkoutGitBranch(pid, branch)
      mutateBranchState((prev) => ({
        current: res.current,
        branches: prev?.branches.includes(res.current)
          ? prev.branches
          : [...(prev?.branches ?? []), res.current].sort(),
        remoteBranches: prev?.remoteBranches ?? [],
      }))
      setSelected(new Set<string>())
      setActivePath(null)
      setBranchQuery('')
      setBranchSheet(false)
      showToast(t('git.switched', { branch: res.current }))
      await refreshChanges(pid)
      await refetchBranches()
    })

  const merge = (branch: string) =>
    run('merge', async (pid) => {
      try {
        const res = await api.mergeGitBranch(pid, branch)
        showToast(
          res.alreadyUpToDate
            ? t('git.mergeUpToDate', { current: res.current, branch: res.merged })
            : t('git.merged', { current: res.current, branch: res.merged }),
        )
        setMergeTarget(null)
        setMergeQuery('')
        await refreshChanges(pid)
        await refetchBranches()
      } finally {
        // 成败都关：失败时留着弹层会盖住那条 toast。
        setMergeSheet(false)
      }
    })

  const moreItems = (): ActionSheetItem[] => {
    if (confirmingDiscard()) {
      return [
        {
          label: t('git.discardConfirm'),
          tone: 'destructive',
          // 确认即关：留着面板会盖住随后的 toast，也让人以为还能再点一次。
          onSelect: () => {
            setMoreOpen(false)
            setConfirmingDiscard(false)
            discard()
          },
        },
      ]
    }
    // 全选不在这里：它是勾选文件的高频前置动作，已经提到底部操作栏常驻，
    // 浮层里再留一份就是两个入口、两份真相。
    const items: ActionSheetItem[] = []
    if (props.onOpenHistory) {
      items.push({
        label: t('git.history'),
        onSelect: () => {
          setMoreOpen(false)
          props.onOpenHistory?.()
        },
      })
    }
    items.push({
      label: t('git.push'),
      onSelect: () => {
        setMoreOpen(false)
        void push()
      },
    })
    items.push({
      label: t('git.pull'),
      onSelect: () => {
        setMoreOpen(false)
        void pull()
      },
    })
    items.push({
      label: t('git.mergeBranch'),
      onSelect: () => {
        setMoreOpen(false)
        setMergeTarget(null)
        setMergeQuery('')
        setMergeSheet(true)
      },
    })
    return items
  }

  return (
    <Page
      title={props.title}
      fill
      onBack={props.onBack}
      actions={
        <button
          type="button"
          class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
          aria-label={t('git.more')}
          disabled={anyRunning()}
          onClick={() => {
            setConfirmingDiscard(false)
            setMoreOpen(true)
          }}
        >
          <MoreHorizontal size={20} aria-hidden="true" />
        </button>
      }
      footer={
        <Show when={activeProjectId()}>
          {/*
            两层：外层只吃安全区（边框与底色也留在外层，分隔线要通条贯穿到屏幕边），
            内层给视觉内边距。安全区工具类在产物 CSS 中排在 Tailwind 的 p* 之后，
            写在同一元素上是覆盖而非叠加——没有刘海的设备上 max(env(...),0) 取 0，
            左右与底部内边距会被整个吃掉，控件直接贴边。
          */}
          <div class="shrink-0 border-t border-border bg-card px-safe pb-safe">
            <div class="px-4 pb-3 pt-2">
              {/* 只有 spec 入口才有派发对象：扩展页没有 spec 上下文，`gitOp` 无从调起。 */}
              <Show when={hasSpec()}>
                <div class="mb-2 flex rounded-lg border border-border p-0.5" role="radiogroup">
                  <For
                    each={
                      [
                        ['manual', t('git.manualSelect')],
                        ['agent', t('git.agentSelect')],
                      ] as const
                    }
                  >
                    {([value, label]) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={mode() === value}
                        class={cn(
                          'min-h-9 flex-1 rounded-md text-xs active:opacity-80 disabled:opacity-40',
                          mode() === value
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground',
                        )}
                        disabled={anyRunning()}
                        onClick={() => setMode(value)}
                      >
                        {label}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              {/*
                agent 模式下提交信息由 agent 自己写（`gitOp` 的请求体里没有 message
                这一项），输入框留着只会误导人以为它会被采纳。
              */}
              <Show when={mode() === 'manual'}>
                <textarea
                  ref={setMessageEl}
                  rows={1}
                  class="w-full resize-none overflow-y-hidden rounded-lg border border-border bg-background px-3 py-2 text-base leading-6 outline-none focus:border-primary"
                  placeholder={t('git.commitPlaceholder')}
                  value={message()}
                  disabled={anyRunning()}
                  onInput={(e) => {
                    autoSizeTextarea(e.currentTarget, COMMIT_MAX_ROWS)
                    setUserEditedMsg(true)
                    setMessage(e.currentTarget.value)
                  }}
                />
              </Show>
              <div class="flex items-center gap-2">
                {/* 全选常驻在最左：勾选文件的高频前置动作，不该藏进顶栏的「更多」浮层。
                    agent 模式没有勾选列表，全选无对象，整颗按钮不渲染。 */}
                <Show when={mode() === 'manual'}>
                  <button
                    type="button"
                    class="min-h-11 shrink-0 rounded-lg px-3 text-sm active:bg-accent disabled:opacity-40"
                    disabled={anyRunning() || changes().length === 0}
                    onClick={toggleAll}
                  >
                    {allSelected() ? t('git.deselectAll') : t('git.selectAll')}
                  </button>
                </Show>
                {/* 四段挤在一行，窄屏优先截断计数文本而不是压扁按钮 */}
                <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {mode() === 'agent'
                    ? t('git.agentScope', { total: changes().length })
                    : t('git.fileCount', { selected: selected().size, total: changes().length })}
                </span>
                <button
                  type="button"
                  class="min-h-11 shrink-0 rounded-lg px-4 text-sm text-destructive active:bg-accent disabled:opacity-40"
                  disabled={!canDiscard()}
                  onClick={() => {
                    setConfirmingDiscard(true)
                    setMoreOpen(true)
                  }}
                >
                  {busy() === 'discard' || agentKind() === 'discard'
                    ? t('git.discarding')
                    : t('git.discard')}
                </button>
                <button
                  type="button"
                  class="min-h-11 shrink-0 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground active:opacity-80 disabled:opacity-40"
                  disabled={!canCommit()}
                  onClick={() => commit()}
                >
                  {busy() === 'commit' || agentKind() === 'commit'
                    ? t('git.committing')
                    : t('git.commit')}
                </button>
              </div>
            </div>
          </div>
        </Show>
      }
    >
      <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
        {/* 分支条：紧贴顶栏，点开切换分支弹层 */}
        <button
          type="button"
          class="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2.5 text-left active:bg-accent disabled:opacity-40"
          disabled={anyRunning() || branchState.loading}
          onClick={() => {
            setBranchQuery('')
            setBranchSheet(true)
          }}
        >
          <GitBranch size={16} class="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate font-mono text-sm">
            {branchState()?.current ?? t('git.branch')}
          </span>
          <span class="shrink-0 text-xs text-muted-foreground">
            {busy() === 'checkout' ? t('common.loading') : t('git.switchBranch')}
          </span>
        </button>

        {/* agent 模式不渲染勾选列表：范围由 agent 自己定，摆一份勾不动的列表只会误导。 */}
        <Show when={mode() === 'manual'} fallback={<Notice title={t('git.agentModeHint')} />}>
          <Show when={changes().length > 0} fallback={<Notice title={t('git.empty')} />}>
            {/*
              未选中文件时列表占满全高；选中之后收成 38dvh，把下半屏让给 diff 预览。
              两段各自 .scroll-y，外层 Page 用 fill 关掉了自己的滚动。
            */}
            <div
              class={cn(
                'scroll-y min-h-0 divide-y-[0.5px] divide-border',
                activePath() ? 'max-h-[38dvh] shrink-0' : 'flex-1',
              )}
            >
              <GitFileList
                files={changes()}
                activePath={activePath()}
                selectedPaths={selected()}
                disabled={anyRunning()}
                onToggle={togglePath}
                onSelect={(path) => setActivePath((prev) => (prev === path ? null : path))}
              />
            </div>

            <Show when={activePath()}>
              {(path) => (
                <GitDiffView
                  path={path()}
                  patch={diff()?.patch ?? ''}
                  binary={diff()?.binary ?? false}
                  truncated={diff()?.truncated ?? false}
                  loading={diff.loading}
                  error={diff.error ? (diff.error as Error).message : null}
                  onClose={() => setActivePath(null)}
                />
              )}
            </Show>
          </Show>
        </Show>
      </Show>

      <ActionSheet
        open={moreOpen()}
        description={
          confirmingDiscard()
            ? mode() === 'agent'
              ? t('git.discardAllHint')
              : t('git.discardHint')
            : undefined
        }
        items={moreItems()}
        onClose={() => {
          setMoreOpen(false)
          setConfirmingDiscard(false)
        }}
      />

      <Sheet
        open={branchSheet()}
        title={t('git.switchBranch')}
        onClose={() => setBranchSheet(false)}
      >
        <BranchFilter value={branchQuery()} onInput={setBranchQuery} />
        <Show
          when={filteredBranches().length > 0}
          fallback={
            <p class="py-6 text-center text-sm text-muted-foreground">{t('git.noBranches')}</p>
          }
        >
          <ul class="divide-y-[0.5px] divide-border">
            <For each={filteredBranches()}>
              {(branch) => (
                <li>
                  <button
                    type="button"
                    class="flex min-h-11 w-full items-center gap-2 py-2 text-left font-mono text-sm active:bg-accent disabled:opacity-40"
                    disabled={anyRunning() || branch === branchState()?.current}
                    onClick={() => void checkout(branch)}
                  >
                    <span class="min-w-0 flex-1 truncate">{branch}</span>
                    <Show when={branch === branchState()?.current}>
                      <Check size={16} class="shrink-0 text-primary" aria-hidden="true" />
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Sheet>

      <Sheet open={mergeSheet()} title={t('git.mergeBranch')} onClose={() => setMergeSheet(false)}>
        <BranchFilter value={mergeQuery()} onInput={setMergeQuery} />
        <Show
          when={filteredMergeCandidates().length > 0}
          fallback={
            <p class="py-6 text-center text-sm text-muted-foreground">{t('git.noBranches')}</p>
          }
        >
          <ul class="divide-y-[0.5px] divide-border">
            <For each={filteredMergeCandidates()}>
              {(branch) => (
                <li class={cn('flex items-center gap-2', mergeTarget() === branch && 'bg-accent')}>
                  <button
                    type="button"
                    class="min-h-11 min-w-0 flex-1 truncate py-2 text-left font-mono text-sm active:opacity-80 disabled:opacity-40"
                    disabled={branch === branchState()?.current}
                    title={branch === branchState()?.current ? t('git.mergeSelfHint') : branch}
                    onClick={() => setMergeTarget(branch)}
                  >
                    {branch}
                  </button>
                  {/* 两段式：合并只从这个显式动作触发，误触行本身永远改不了历史 */}
                  <Show when={mergeTarget() === branch}>
                    <button
                      type="button"
                      class="my-1 min-h-9 shrink-0 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground active:opacity-80 disabled:opacity-40"
                      disabled={anyRunning()}
                      onClick={() => void merge(branch)}
                    >
                      {busy() === 'merge' ? t('git.merging') : t('git.mergeAction')}
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Sheet>
    </Page>
  )
}

const BranchFilter: Component<{ value: string; onInput: (v: string) => void }> = (props) => (
  <input
    type="text"
    class="mb-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
    placeholder={t('git.branchFilterPlaceholder')}
    autocapitalize="off"
    autocorrect="off"
    spellcheck={false}
    value={props.value}
    onInput={(e) => props.onInput(e.currentTarget.value)}
  />
)
