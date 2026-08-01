import {
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { A, useParams } from '@solidjs/router'
import { ArrowLeft, Square } from 'lucide-solid'
import { api, type CommandRun } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { subscribeCommandOutput } from '../lib/sse.js'
import {
  appendChunk,
  capText,
  emptyOutputState,
  stateFromSlice,
  type CommandOutputState,
} from '../lib/command-output.js'
import { formatDuration } from '../components/RunningCommands.jsx'
import { CommandStatusText } from '../components/CommandStatusText.jsx'
import { Button } from '../components/ui/button.jsx'
import { toast } from '../components/ui/sonner.jsx'
import { t } from '../i18n/index.js'

/** Batch high-frequency deltas into one DOM write, as ChatPanel does. */
const FLUSH_MS = 80
/** Only follow the tail when the user is already parked at the bottom. */
const AUTO_SCROLL_THRESHOLD = 96
/** Retained characters; a long-running dev server would otherwise grow forever. */
const MAX_CHARS = 400_000

export const CommandRunDetail: Component = () => {
  const params = useParams<{ runId: string }>()
  const projectId = useCurrentProjectId()

  const [run, { mutate: mutateRun }] = createResource<CommandRun | null, [string, string]>(
    () => [projectId(), params.runId] as [string, string],
    async ([pid, runId]) => (pid && runId ? api.getCommandRun(pid, runId) : null),
  )

  const [output, setOutput] = createSignal<CommandOutputState>(emptyOutputState())
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [stopping, setStopping] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())

  let preEl: HTMLPreElement | undefined
  let autoScroll = true
  let pending: CommandOutputState | null = null
  let flushTimer: number | null = null
  let refetching = false

  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  function scheduleFlush(next: CommandOutputState) {
    pending = capText(next, MAX_CHARS)
    if (flushTimer !== null) return
    flushTimer = window.setTimeout(() => {
      flushTimer = null
      if (!pending) return
      setOutput(pending)
      pending = null
      if (autoScroll && preEl) preEl.scrollTop = preEl.scrollHeight
    }, FLUSH_MS)
  }

  onCleanup(() => {
    if (flushTimer !== null) window.clearTimeout(flushTimer)
  })

  /** Full resync: used for the first paint and whenever a chunk lands out of order. */
  async function reload(pid: string, runId: string): Promise<void> {
    if (refetching) return
    refetching = true
    try {
      const slice = await api.readCommandOutput(pid, runId)
      const next = capText(stateFromSlice(slice), MAX_CHARS)
      pending = null
      setOutput(next)
      setLoadError(null)
      if (preEl) preEl.scrollTop = preEl.scrollHeight
    } catch (err) {
      setLoadError((err as Error).message)
    } finally {
      refetching = false
    }
  }

  createEffect(() => {
    const pid = projectId()
    const runId = params.runId
    if (!pid || !runId) return
    setOutput(emptyOutputState())
    void reload(pid, runId)
    const unsub = subscribeCommandOutput(pid, runId, {
      onOutput: (chunk) => {
        const base = pending ?? output()
        const result = appendChunk(base, chunk)
        // A gap means frames were missed (reconnect, or the tail was already
        // running when we attached) — the byte stream cannot be spliced, so
        // re-read the whole slice instead of rendering corrupted output.
        if (result.needsRefetch) void reload(pid, runId)
        else scheduleFlush(result.state)
      },
      onRun: (next) => mutateRun(next),
      onError: (message) => setLoadError(message),
    })
    onCleanup(unsub)
  })

  function onScroll() {
    if (!preEl) return
    autoScroll = preEl.scrollHeight - preEl.scrollTop - preEl.clientHeight <= AUTO_SCROLL_THRESHOLD
  }

  async function onStop() {
    const pid = projectId()
    const current = run()
    if (!pid || !current) return
    setStopping(true)
    try {
      // Stop deliberately keeps the record and its log: the point of this page
      // is to read the output after the process is gone.
      const res = await api.stopCommandRun(pid, current.runId)
      mutateRun(res.run)
      toast.success(t('commands.stopped'))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setStopping(false)
    }
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

            <Show when={output().truncated}>
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
              {output().text || t('commands.outputEmpty')}
            </pre>
          </>
        )}
      </Show>
    </section>
  )
}
