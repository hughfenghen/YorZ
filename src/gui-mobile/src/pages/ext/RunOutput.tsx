import { Show, createSignal, type Component } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { MoreHorizontal } from 'lucide-solid'
import type { CommandRunStatus } from '@shared/api/index.js'
import { createCommandRunView } from '@shared/lib/command-run-view.js'
import { formatDuration } from '@shared/lib/duration.js'
import { Page } from '@/components/Page.jsx'
import { ActionSheet, type ActionSheetItem } from '@/components/ActionSheet.jsx'
import { Notice } from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { copyText } from '@/lib/clipboard.js'
import { t } from '@/i18n/index.js'

/**
 * 贴底判定阈值。比桌面端同名常量（96px）宽一档：移动端的惯性滚动会在松手后
 * 继续滑一段，96px 的容差下「用户明明停在底部」却被判成已离开，尾随就断了。
 */
const AUTO_SCROLL_THRESHOLD = 160

/** 运行状态 → 语义色，与桌面端 CommandStatusText 的 STATUS_TEXT 同一套口径。 */
const STATUS_TONE: Record<CommandRunStatus, string> = {
  running: 'text-success',
  exited: 'text-muted-foreground',
  killed: 'text-warning',
  failed: 'text-destructive',
}

const STATUS_KEY: Record<CommandRunStatus, string> = {
  running: 'runOutput.statusRunning',
  exited: 'runOutput.statusExited',
  killed: 'runOutput.statusKilled',
  failed: 'runOutput.statusFailed',
}

/**
 * 扩展二级页：某次运行的输出。
 *
 * 编排整个下沉在 `@shared/lib/command-run-view`（与桌面端 CommandRunDetail 同源），
 * 这里只留移动端自己的外壳：滚动容器、贴底判定、动作面板与文案。
 *
 * 不做 ANSI 渲染：全仓没有任何 ANSI/xterm 依赖，桌面端同样是裸文本，
 * 移动端单独引终端渲染库会引入两端不一致与显著体积。
 */
export const RunOutput: Component = () => {
  const navigate = useNavigate()
  const params = useParams<{ runId: string }>()

  let scrollEl: HTMLDivElement | undefined
  let autoScroll = true

  const toBottom = () => {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
  }

  const view = createCommandRunView({
    projectId: () => activeProjectId() ?? undefined,
    runId: () => params.runId,
    onFlush: () => {
      if (autoScroll) toBottom()
    },
    onReset: toBottom,
  })

  const [menuOpen, setMenuOpen] = createSignal(false)
  const [confirmingStop, setConfirmingStop] = createSignal(false)

  const closeMenu = () => {
    setMenuOpen(false)
    setConfirmingStop(false)
  }

  const stop = async () => {
    closeMenu()
    const res = await view.stop()
    if (res.ok) showToast(t('runOutput.stopped'))
    else if (res.error) showToast(res.error, 'error')
  }

  const copy = async (text: string) => {
    closeMenu()
    const ok = await copyText(text)
    showToast(ok ? t('runOutput.copied') : t('runOutput.copyFailed'), ok ? 'default' : 'error')
  }

  const menuItems = (): ActionSheetItem[] => {
    const run = view.run()
    if (!run) return []
    // 终止不可逆（进程直接被杀），与扩展页/脚本页同一套两段式确认。
    if (confirmingStop()) {
      return [{ label: t('runOutput.stopConfirm'), tone: 'destructive', onSelect: () => void stop() }]
    }
    const items: ActionSheetItem[] = []
    if (run.status === 'running') {
      items.push({
        label: t('runOutput.stop'),
        tone: 'destructive',
        onSelect: () => setConfirmingStop(true),
      })
    }
    items.push({ label: t('runOutput.copyOutput'), onSelect: () => void copy(view.text()) })
    items.push({ label: t('runOutput.copyPath'), onSelect: () => void copy(run.logFile) })
    return items
  }

  return (
    <Page
      title={view.run()?.name || t('runOutput.title')}
      padded={false}
      onBack={() => navigate('/ext')}
      scrollRef={(el) => (scrollEl = el)}
      onScroll={() => {
        if (!scrollEl) return
        autoScroll =
          scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <=
          AUTO_SCROLL_THRESHOLD
      }}
      actions={
        <Show when={view.run()}>
          <button
            type="button"
            class="tap-target -mr-2 flex items-center justify-center rounded-md text-muted-foreground active:bg-accent"
            aria-label={t('specDetail.more')}
            onClick={() => {
              setConfirmingStop(false)
              setMenuOpen(true)
            }}
          >
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
        </Show>
      }
    >
      <Show
        when={view.run()}
        fallback={<Notice title={view.loadError() ?? t('common.loading')} />}
      >
        {(run) => (
          <>
            <div class="border-b border-border bg-card px-4 py-2.5">
              <div class="flex items-center gap-2">
                <span class={`shrink-0 text-xs font-medium ${STATUS_TONE[run().status]}`}>
                  {t(STATUS_KEY[run().status])}
                </span>
                <time class="text-xs text-muted-foreground">
                  {formatDuration(run().startedAt, run().endedAt, view.now())}
                </time>
                <Show when={run().status !== 'running'}>
                  <span class="text-xs text-muted-foreground">
                    {run().signal
                      ? `${t('runOutput.signal')} ${run().signal}`
                      : `${t('runOutput.exitCode')} ${run().exitCode ?? '—'}`}
                  </span>
                </Show>
              </div>
              <p class="mt-1 truncate font-mono text-xs text-muted-foreground">{run().cli}</p>
            </div>

            <Show when={view.truncated()}>
              <p class="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                {t('runOutput.truncated')}
              </p>
            </Show>
            <Show when={view.loadError()}>
              <p class="border-b border-border px-4 py-2 text-xs text-destructive">
                {view.loadError()}
              </p>
            </Show>

            {/*
              break-all 而不是横向滚动：长行在窄屏上横滚需要双向手势，
              和纵向的尾随滚动互相打架。
            */}
            <pre class="m-0 whitespace-pre-wrap break-all px-4 py-3 font-mono text-xs leading-snug">
              {view.text() || t('runOutput.outputEmpty')}
            </pre>
          </>
        )}
      </Show>

      <ActionSheet
        open={menuOpen()}
        title={view.run()?.name}
        description={confirmingStop() ? t('runOutput.stopHint') : undefined}
        items={menuItems()}
        onClose={closeMenu}
      />
    </Page>
  )
}
