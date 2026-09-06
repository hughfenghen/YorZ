import { Show, type Component } from 'solid-js'
import { A, useParams } from '@solidjs/router'
import { ArrowLeft, Square } from 'lucide-solid'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { createCommandRunView } from '@shared/lib/command-run-view.js'
import { formatDuration } from '../components/RunningCommands.jsx'
import { CommandStatusText } from '../components/CommandStatusText.jsx'
import { Button } from '../components/ui/button.jsx'
import { toast } from '../components/ui/toast.jsx'
import { t } from '../i18n/index.js'

/** Only follow the tail when the user is already parked at the bottom. */
const AUTO_SCROLL_THRESHOLD = 96

export const CommandRunDetail: Component = () => {
  const params = useParams<{ runId: string }>()
  const projectId = useCurrentProjectId()

  let preEl: HTMLPreElement | undefined
  let autoScroll = true

  const view = createCommandRunView({
    projectId: () => projectId() || undefined,
    runId: () => params.runId,
    onFlush: () => {
      if (autoScroll && preEl) preEl.scrollTop = preEl.scrollHeight
    },
    onReset: () => {
      if (preEl) preEl.scrollTop = preEl.scrollHeight
    },
  })
  const { run, loadError, stopping, now } = view

  function onScroll() {
    if (!preEl) return
    autoScroll = preEl.scrollHeight - preEl.scrollTop - preEl.clientHeight <= AUTO_SCROLL_THRESHOLD
  }

  async function onStop() {
    const res = await view.stop()
    if (res.ok) toast.success(t('commands.stopped'))
    else if (res.error) toast.error(res.error)
  }

  return (
    <section class="flex h-full min-h-0 flex-col overflow-hidden p-2">
      <header class="flex items-center gap-3">
        <Button as={A} href={projectHref('')} variant="ghost" size="sm">
          <ArrowLeft class="mr-1 h-4 w-4" />
          {t('commands.back')}
        </Button>
        <h1 class="m-0 text-xl">{t('commands.detailTitle')}</h1>
      </header>

      <Show
        when={run()}
        fallback={<p class="text-muted-foreground">{loadError() ?? t('common.loading')}</p>}
      >
        {(current) => (
          <>
            <div class="mt-2 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2">
              <Show when={current().status === 'running'}>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={stopping()}
                  onClick={() => void onStop()}
                >
                  <Square class="mr-1 h-3.5 w-3.5" />
                  {stopping() ? t('commands.stopping') : t('commands.stop')}
                </Button>
              </Show>
              <CommandStatusText status={current().status} />
              <span class="font-medium">{current().name}</span>
              <code class="font-mono text-xs text-muted-foreground">{current().cli}</code>
              <span class="text-xs text-muted-foreground">
                {t('commands.duration')}:{' '}
                {formatDuration(current().startedAt, current().endedAt, now())}
              </span>
              <Show when={current().status !== 'running'}>
                <span class="text-xs text-muted-foreground">
                  {t('commands.exitCode')}: {current().exitCode ?? current().signal ?? '—'}
                </span>
              </Show>
              {/* Surfaced verbatim so it can be pasted into an agent prompt. */}
              <code class="ml-auto font-mono text-xs text-muted-foreground">
                {t('commands.logFile')}: {current().logFile}
              </code>
            </div>

            <Show when={view.truncated()}>
              <p class="m-0 mt-2 text-xs text-muted-foreground">{t('commands.outputTruncated')}</p>
            </Show>
            <Show when={loadError()}>
              <p class="m-0 mt-2 text-xs text-destructive">{loadError()}</p>
            </Show>

            <pre
              ref={preEl}
              onScroll={onScroll}
              class="mt-2 min-h-0 flex-1 overflow-auto rounded-lg border bg-background p-3 font-mono text-[12px] leading-snug"
            >
              {view.text() || t('commands.outputEmpty')}
            </pre>
          </>
        )}
      </Show>
    </section>
  )
}
