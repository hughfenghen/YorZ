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
import { ChevronRight, GitBranch, RotateCcw, Terminal, X } from 'lucide-solid'
import { api, type CommandRun } from '@shared/api/index.js'
import { subscribeCommandRuns } from '@shared/api/sse.js'
import { formatDuration } from '@shared/lib/duration.js'
import { Page } from '@/components/Page.jsx'
import {
  ErrorNotice,
  LoadingNotice,
  NoProjectNotice,
  comingSoon,
} from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { t } from '@/i18n/index.js'

/**
 * Tab3 扩展。三组结构对齐线框图：脚本管理入口 / 运行中的脚本 / Git 入口。
 * 两个入口行的二级页本次不实现，点击弹「即将支持」；中间那组是本页唯一的真实数据。
 */

const Group: Component<{ title: string; children: import('solid-js').JSX.Element }> = (props) => (
  <section class="mb-6">
    <h2 class="mb-2 px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {props.title}
    </h2>
    <div class="divide-y divide-border border-y border-border bg-card">{props.children}</div>
  </section>
)

const EntryRow: Component<{
  icon: Component<{ size?: number; class?: string }>
  label: string
  desc: string
  onClick: () => void
}> = (props) => (
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent"
    onClick={() => props.onClick()}
  >
    <props.icon size={18} class="shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm">{props.label}</span>
      <span class="block truncate text-xs text-muted-foreground">{props.desc}</span>
    </span>
    <ChevronRight size={18} class="shrink-0 text-muted-foreground" />
  </button>
)

export const Extensions: Component = () => {
  const [runs, { refetch, mutate }] = createResource<CommandRun[], string>(
    () => activeProjectId() ?? undefined,
    (pid) => api.listCommandRuns(pid),
  )

  // 这个 topic 推的是全量 CommandRun[]，直接 mutate 即可，不必 refetch 多打一次 HTTP。
  createEffect(() => {
    const id = activeProjectId()
    if (!id) return
    const unsub = subscribeCommandRuns(id, (next) => mutate(next))
    onCleanup(() => unsub())
  })

  // 运行时长要每秒往前走，但服务端不会为此推事件；本地起一个 1s 心跳当时钟。
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  const running = createMemo(() => (runs() ?? []).filter((r) => r.status === 'running'))

  const restart = async (run: CommandRun) => {
    const pid = activeProjectId()
    if (!pid) return
    try {
      // 与桌面端 RunningCommands 同序：先清掉旧记录再重跑，
      // 否则同一个 commandId 会在列表里留下一条已死的孤儿行。
      await api.clearCommandRun(pid, run.runId)
      await api.runCommand(pid, run.commandId)
      showToast(t('ext.restarted'))
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const stop = async (run: CommandRun) => {
    const pid = activeProjectId()
    if (!pid) return
    try {
      await api.stopCommandRun(pid, run.runId)
      showToast(t('ext.stopped'))
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <Page title={t('ext.title')} padded={false}>
      <div class="py-4">
        <Group title={t('ext.scripts')}>
          <EntryRow
            icon={Terminal}
            label={t('ext.scripts')}
            desc={t('ext.scriptsDesc')}
            onClick={comingSoon}
          />
        </Group>

        <Group title={t('ext.running')}>
          <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
            <Show when={!runs.loading} fallback={<LoadingNotice />}>
              <Show
                when={!runs.error}
                fallback={<ErrorNotice error={runs.error} onRetry={() => void refetch()} />}
              >
                {/* 空态保留分组标题与容器，不整组隐藏——否则脚本一停一起，页面会跳一下 */}
                <Show
                  when={running().length > 0}
                  fallback={
                    <p class="px-4 py-6 text-center text-sm text-muted-foreground">
                      {t('ext.runningEmpty')}
                    </p>
                  }
                >
                  <For each={running()}>
                    {(run) => (
                      <div class="flex items-center gap-2 px-4 py-2.5">
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-sm">{run.name}</span>
                          <span class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                            <time>{formatDuration(run.startedAt, run.endedAt, now())}</time>
                            <span>·</span>
                            <span class="truncate">{run.cli}</span>
                          </span>
                        </span>
                        <button
                          type="button"
                          class="tap-target flex shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
                          aria-label={t('ext.restart')}
                          onClick={() => void restart(run)}
                        >
                          <RotateCcw size={18} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          class="tap-target flex shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
                          aria-label={t('ext.stop')}
                          onClick={() => void stop(run)}
                        >
                          <X size={18} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
            </Show>
          </Show>
        </Group>

        <Group title={t('ext.git')}>
          <EntryRow
            icon={GitBranch}
            label={t('ext.git')}
            desc={t('ext.gitDesc')}
            onClick={comingSoon}
          />
        </Group>
      </div>
    </Page>
  )
}
