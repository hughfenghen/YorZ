import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { A } from '@solidjs/router'
import { X } from 'lucide-solid'
import { api, type CommandRun } from '../lib/api.js'
import { projectHref } from '../lib/project.js'
import { subscribeCommandRuns } from '../lib/sse.js'
import { Button } from './ui/button.jsx'
import { CommandStatusText } from './CommandStatusText.jsx'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.jsx'
import { toast } from './ui/sonner.jsx'
import { t } from '../i18n/index.js'

export function formatDuration(
  startedAt: number,
  endedAt: number | undefined,
  now: number,
): string {
  const ms = Math.max(0, (endedAt ?? now) - startedAt)
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export interface RunningCommandsProps {
  projectId: () => string
  /** Bumping this value forces a refetch (e.g. right after starting a run). */
  revision?: () => number
}

export const RunningCommands: Component<RunningCommandsProps> = (props) => {
  const [runs, { refetch, mutate }] = createResource<CommandRun[], string>(
    props.projectId,
    (pid) => (pid ? api.listCommandRuns(pid) : Promise.resolve([])),
  )
  // Drives the live duration readout for still-running entries.
  const [now, setNow] = createSignal(Date.now())
  const [clearing, setClearing] = createSignal<string | null>(null)

  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  createEffect(() => {
    props.revision?.()
    void refetch()
  })

  createEffect(() => {
    const pid = props.projectId()
    if (!pid) return
    const unsub = subscribeCommandRuns(pid, (next) => mutate(next))
    onCleanup(unsub)
  })

  async function onClear(run: CommandRun) {
    const pid = props.projectId()
    if (!pid) return
    setClearing(run.runId)
    try {
      await api.clearCommandRun(pid, run.runId)
      await refetch()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setClearing(null)
    }
  }

  return (
    <Show when={(runs() ?? []).length > 0}>
      <section class="mt-3">
        <h2 class="m-0 mb-1.5 text-sm font-medium text-muted-foreground">
          {t('commands.running')}
        </h2>
        {/* Same responsive grid as the spec card list below, so both blocks
            share column widths and reflow together. */}
        <ul class="grid list-none gap-2 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr))]">
          <For each={runs() ?? []}>
            {(run) => (
              <li class="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
                <A
                  href={projectHref(`commands/${encodeURIComponent(run.runId)}`)}
                  class="flex min-w-0 flex-1 items-center gap-3"
                >
                  <CommandStatusText status={run.status} />
                  <span class="truncate font-medium">{run.name}</span>
                  <span class="truncate font-mono text-xs text-muted-foreground">{run.cli}</span>
                  <span class="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                    {formatDuration(run.startedAt, run.endedAt, now())}
                  </span>
                </A>
                <Popover>
                  <PopoverTrigger
                    as={Button}
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 shrink-0"
                    title={t('commands.clear')}
                  >
                    <X class="h-4 w-4" />
                  </PopoverTrigger>
                  <PopoverContent class="w-72">
                    <p class="m-0 text-sm font-medium">{t('commands.clearTitle')}</p>
                    <p class="mb-3 mt-1 text-xs text-muted-foreground">
                      {t('commands.clearDescription')}
                    </p>
                    <div class="flex justify-end">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={clearing() === run.runId}
                        onClick={() => void onClear(run)}
                      >
                        {clearing() === run.runId ? t('common.deleting') : t('commands.clear')}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  )
}
