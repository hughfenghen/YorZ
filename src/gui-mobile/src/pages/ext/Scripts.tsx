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
import { Play, Plus, Trash2 } from 'lucide-solid'
import { api, type CommandDef, type CommandRun } from '@shared/api/index.js'
import { subscribeCommandRuns } from '@shared/api/sse.js'
import { Page } from '@/components/Page.jsx'
import { Sheet } from '@/components/Sheet.jsx'
import { ActionSheet, type ActionSheetItem } from '@/components/ActionSheet.jsx'
import { ErrorNotice, LoadingNotice, NoProjectNotice, Notice } from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { t } from '@/i18n/index.js'

/** 对齐服务端 routes/commands.ts 的 MAX_NAME_LEN / MAX_CLI_LEN，本地先挡一道。 */
const MAX_NAME_LEN = 120
const MAX_CLI_LEN = 2000

/**
 * 扩展二级页：脚本管理。
 *
 * 桌面端把同样的能力塞在一个 DropdownMenu + 新增 Dialog 里（CommandMenu.tsx），
 * 移动端换成「列表 + 行尾图标 + 底部表单」，逻辑语义保持一致。
 *
 * 行主体是纯展示：执行与删除各自有独立的图标按钮，点行本身什么都不会发生。
 * 「点哪都跑」的代价是真起一个进程，而脚本没有详情页可去，与其给行一个时灵时
 * 不灵的点击目标，不如让它彻底不可点。
 *
 * 没有「编辑」：服务端只有 GET / POST / DELETE 三个定义级端点，改脚本 = 删了重建，
 * 桌面端同样如此。
 */
export const Scripts: Component = () => {
  const navigate = useNavigate()

  const [defs, { refetch, mutate: mutateDefs }] = createResource<CommandDef[], string>(
    () => activeProjectId() ?? undefined,
    (pid) => api.listCommands(pid),
  )

  // 运行态只为了给行尾那个「运行中」小字：topic 推的是全量 CommandRun[]，
  // 和扩展页一样直接 mutate，不必再打一次 HTTP。
  const [runs, setRuns] = createSignal<CommandRun[]>([])
  createEffect(() => {
    const pid = activeProjectId()
    if (!pid) return
    void api
      .listCommandRuns(pid)
      .then(setRuns)
      .catch(() => {
        // 运行态只是行尾的一个标记，拉不到就先不标；SSE 推来会自愈。
      })
    const unsub = subscribeCommandRuns(pid, (next) => setRuns(next))
    onCleanup(() => unsub())
  })

  const runningIds = createMemo(
    () =>
      new Set(
        runs()
          .filter((r) => r.status === 'running')
          .map((r) => r.commandId),
      ),
  )

  /** 非 null ⇒ 正在为这个脚本做删除二次确认。 */
  const [deleteDef, setDeleteDef] = createSignal<CommandDef | null>(null)
  const [addOpen, setAddOpen] = createSignal(false)

  /**
   * 运行并进入输出页。
   *
   * 服务端 run() 对同一个 commandId 已有 running 时幂等返回旧记录，所以
   * 「运行中的脚本再点一次」天然变成「查看它的输出」，前端不必分支。
   */
  const run = async (def: CommandDef) => {
    const pid = activeProjectId()
    if (!pid) return
    try {
      const started = await api.runCommand(pid, def.id)
      navigate(`/ext/runs/${encodeURIComponent(started.runId)}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('scripts.runFailed'), 'error')
    }
  }

  const remove = async (def: CommandDef) => {
    const pid = activeProjectId()
    if (!pid) return
    setDeleteDef(null)
    try {
      await api.deleteCommand(pid, def.id)
      // 定义列表没有自己的 SSE topic，本地摘掉即可——refetch 只会多打一次 HTTP。
      mutateDefs((prev) => (prev ?? []).filter((d) => d.id !== def.id))
      showToast(t('scripts.deleted'))
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  // 删除不可逆，图标一点就没了太危险，所以入口只负责开确认面板。
  // 入口本身已经写着「删除」，确认面板不必再摆一遍动作菜单，单段即可。
  const deleteItems = (): ActionSheetItem[] => {
    const def = deleteDef()
    if (!def) return []
    return [
      {
        label: t('scripts.deleteConfirm'),
        tone: 'destructive',
        onSelect: () => void remove(def),
      },
    ]
  }

  return (
    <Page
      title={t('scripts.title')}
      padded={false}
      onBack={() => navigate('/ext')}
      actions={
        <button
          type="button"
          class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
          aria-label={t('scripts.add')}
          onClick={() => setAddOpen(true)}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      }
    >
      <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
        <Show when={!defs.loading} fallback={<LoadingNotice />}>
          <Show
            when={!defs.error}
            fallback={<ErrorNotice error={defs.error} onRetry={() => void refetch()} />}
          >
            <Show
              when={(defs() ?? []).length > 0}
              fallback={<Notice title={t('scripts.empty')} hint={t('scripts.add')} />}
            >
              {/* 底色与扩展页列表同口径：卡片色列表浮在稍深的页面底色上。
                  只收 border-b：首行上方紧邻顶栏的 border-b，再加上边框会叠成 2px。 */}
              <ul class="divide-y divide-border border-b border-border bg-card">
                <For each={defs()}>
                  {(def) => (
                    <li class="no-callout flex select-none items-center gap-3 px-4 py-3">
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm">{def.name}</span>
                        <span class="block truncate font-mono text-xs text-muted-foreground">
                          {def.cli}
                        </span>
                      </span>
                      <Show when={runningIds().has(def.id)}>
                        <span class="shrink-0 text-xs text-success">{t('scripts.running')}</span>
                      </Show>
                      {/* 图标按钮组：按钮视觉就是 20×20 的图标本身（见 app.css 的
                          .tap-target），组内 gap-3 让两枚按钮的命中区正好相接——间距再小
                          两块 ::after 就会重叠，上面那枚永远抢不到点击 */}
                      <span class="flex shrink-0 items-center gap-3">
                        <button
                          type="button"
                          class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
                          aria-label={t('scripts.run')}
                          onClick={() => void run(def)}
                        >
                          <Play size={20} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          class="tap-target flex items-center justify-center text-destructive active:opacity-60"
                          aria-label={t('scripts.delete')}
                          onClick={() => setDeleteDef(def)}
                        >
                          <Trash2 size={20} aria-hidden="true" />
                        </button>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Show>
      </Show>

      <ActionSheet
        open={deleteDef() !== null}
        title={deleteDef()?.name}
        description={t('scripts.deleteHint')}
        items={deleteItems()}
        onClose={() => setDeleteDef(null)}
      />

      <AddScriptSheet
        open={addOpen()}
        onClose={() => setAddOpen(false)}
        onCreated={(def) => {
          mutateDefs((prev) => [...(prev ?? []), def])
          setAddOpen(false)
        }}
      />
    </Page>
  )
}

/** 新增脚本表单。模板对齐 AppendSheet：open 变化时重置草稿、busy 防重复提交。 */
const AddScriptSheet: Component<{
  open: boolean
  onClose: () => void
  onCreated: (def: CommandDef) => void
}> = (props) => {
  const [name, setName] = createSignal('')
  const [cli, setCli] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  createEffect(() => {
    if (props.open) {
      setName('')
      setCli('')
    }
  })

  const valid = createMemo(() => name().trim().length > 0 && cli().trim().length > 0)

  async function submit() {
    const pid = activeProjectId()
    if (!pid || !valid() || busy()) return
    setBusy(true)
    try {
      const def = await api.createCommand(pid, { name: name().trim(), cli: cli().trim() })
      showToast(t('scripts.created'))
      props.onCreated(def)
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={props.open}
      title={t('scripts.addTitle')}
      onClose={props.onClose}
      footer={
        <button
          type="button"
          class="flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground active:opacity-80 disabled:opacity-40"
          disabled={busy() || !valid()}
          onClick={() => void submit()}
        >
          {t('scripts.submit')}
        </button>
      }
    >
      <div class="space-y-4">
        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{t('scripts.name')}</span>
          <input
            type="text"
            maxLength={MAX_NAME_LEN}
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
            placeholder={t('scripts.namePlaceholder')}
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">{t('scripts.cli')}</span>
          <textarea
            rows={2}
            maxLength={MAX_CLI_LEN}
            // 命令行不该被自动大写/自动纠正，手机输入法默认两者都开着。
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            class="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-base outline-none focus:border-primary"
            placeholder={t('scripts.cliPlaceholder')}
            value={cli()}
            onInput={(e) => setCli(e.currentTarget.value)}
          />
        </label>
      </div>
    </Sheet>
  )
}
