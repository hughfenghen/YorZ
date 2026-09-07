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
import { useNavigate } from '@solidjs/router'
import { Page } from '@/components/Page.jsx'
import { ActionSheet, type ActionSheetItem } from '@/components/ActionSheet.jsx'
import { ErrorNotice, NoProjectNotice } from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { t } from '@/i18n/index.js'

/**
 * Tab3 扩展。三组结构对齐线框图：脚本管理入口 / 运行中的脚本 / Git 入口。
 * 三条链路各自有二级页：/ext/scripts、/ext/runs/:runId、/ext/git。
 */

const Group: Component<{ title: string; children: import('solid-js').JSX.Element }> = (props) => (
  <section class="mb-6">
    <h2 class="mb-2 px-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
      {props.title}
    </h2>
    <div class="divide-y-[0.5px] divide-border border-y border-border bg-card">
      {props.children}
    </div>
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
      <span class="block truncate">{props.label}</span>
      <span class="block truncate text-sm text-muted-foreground">{props.desc}</span>
    </span>
    <ChevronRight size={18} class="shrink-0 text-muted-foreground" />
  </button>
)

const RunningStateRow: Component<{ label: string }> = (props) => (
  <p class="px-4 py-4 text-center text-sm text-muted-foreground">{props.label}</p>
)

export const Extensions: Component = () => {
  const navigate = useNavigate()
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

  // 终止是不可逆动作（脚本进程直接被杀），复用 spec 长按菜单那套底部面板做二次确认。
  // 与 Specs 一样只留一个页面级单例：每行各挂一个面板会凭空多出一堆 fixed 节点。
  const [confirmRun, setConfirmRun] = createSignal<CommandRun | null>(null)

  const stop = async (run: CommandRun) => {
    const pid = activeProjectId()
    setConfirmRun(null)
    if (!pid) return
    try {
      await api.stopCommandRun(pid, run.runId)
      showToast(t('ext.stopped'))
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const confirmItems = (): ActionSheetItem[] => {
    const run = confirmRun()
    if (!run) return []
    return [{ label: t('ext.stopConfirm'), tone: 'destructive', onSelect: () => void stop(run) }]
  }

  return (
    <Page title={t('ext.title')} padded={false}>
      <div class="py-4">
        {/* 运行中的脚本没有自己的组标题，直接作为「脚本管理」入口行的兄弟行留在同一张卡里：
            共享的分隔线本身就在说「正在跑的这些，就是上面那个入口管的东西」，
            另起一组标题反而把两件本来是一件事的东西推开了 24px */}
        <Group title={t('ext.scripts')}>
          <EntryRow
            icon={Terminal}
            label={t('ext.scripts')}
            desc={t('ext.scriptsDesc')}
            onClick={() => navigate('/ext/scripts')}
          />

          <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
            <Show when={!runs.loading} fallback={<RunningStateRow label={t('common.loading')} />}>
              <Show
                when={!runs.error}
                fallback={<ErrorNotice error={runs.error} onRetry={() => void refetch()} />}
              >
                {/* 空态保留一行占位，不整段隐藏——否则最后一个脚本停掉时卡片会缩一下 */}
                <Show
                  when={running().length > 0}
                  fallback={<RunningStateRow label={t('ext.runningEmpty')} />}
                >
                  <For each={running()}>
                    {(run) => (
                      <div class="flex items-center gap-2 px-4 py-2.5">
                        {/* 行主体点进输出页；行尾两个图标各有自己的命中区，不会被这层吃掉 */}
                        <button
                          type="button"
                          class="min-w-0 flex-1 text-left active:opacity-60"
                          onClick={() => navigate(`/ext/runs/${encodeURIComponent(run.runId)}`)}
                        >
                          <span class="block truncate text-sm">{run.name}</span>
                          <span class="mt-0.5 flex items-center gap-2 text-muted-foreground">
                            <time>{formatDuration(run.startedAt, run.endedAt, now())}</time>
                            <span>·</span>
                            <span class="truncate">{run.cli}</span>
                          </span>
                        </button>
                        {/* 图标按钮组：按钮视觉就是 20×20 的图标本身（见 app.css 的
                            .tap-target），组内 gap-3 让两枚按钮的命中区正好相接；
                            不再需要负边距补偿——X 的右边界天然落在容器 px-4 的 16px 处，
                            与入口行那个 ChevronRight 对齐 */}
                        <span class="flex shrink-0 items-center gap-3">
                          <button
                            type="button"
                            class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
                            aria-label={t('ext.restart')}
                            onClick={() => void restart(run)}
                          >
                            <RotateCcw size={20} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
                            aria-label={t('ext.stop')}
                            onClick={() => setConfirmRun(run)}
                          >
                            <X size={20} aria-hidden="true" />
                          </button>
                        </span>
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
            onClick={() => navigate('/ext/git')}
          />
        </Group>
      </div>

      <ActionSheet
        open={confirmRun() !== null}
        title={confirmRun()?.name}
        description={t('ext.stopHint')}
        items={confirmItems()}
        onClose={() => setConfirmRun(null)}
      />
    </Page>
  )
}
