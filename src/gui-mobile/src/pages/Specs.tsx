import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Plus } from 'lucide-solid'
import { api, type SpecListItem } from '@shared/api/index.js'
import { subscribeSpecsList } from '@shared/api/sse.js'
import { SPEC_TYPE_TEXT, splitSpecId, stageBadgeClass } from '@shared/lib/spec-meta.js'
import { specFilePath } from '@shared/lib/spec-path.js'
import { formatSpecUpdatedAt } from '@shared/lib/time.js'
import { Page } from '@/components/Page.jsx'
import { ActionSheet, type ActionSheetItem } from '@/components/ActionSheet.jsx'
import { ErrorNotice, LoadingNotice, NoProjectNotice, Notice } from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { copyText } from '@/lib/clipboard.js'
import { createLongPress } from '@/lib/long-press.js'
import { readSpecCache, writeSpecCache } from '@/lib/spec-cache.js'
import { cn } from '@/lib/cn'
import { t } from '@/i18n/index.js'

/**
 * Tab2 spec 列表。
 *
 * 后端 `GET /api/projects/:pid/specs` 已按 `updated_at` 倒序（同值再按 mtime），
 * 前端不再排一遍——重排会和服务端的 tie-break 规则打架。
 *
 * 三行布局：徽章 + 时间 / 标题 / summary。summary 截两行而不是一行，
 * 是因为它是这个列表里唯一能让人不点进去就判断「这条要不要管」的信息。
 */
export const Specs: Component = () => {
  const navigate = useNavigate()
  const [list, setList] = createSignal<SpecListItem[] | null>(null)
  const [specs, { refetch }] = createResource<SpecListItem[], string>(
    () => activeProjectId() ?? undefined,
    (pid) => api.listSpecs(pid),
  )

  // 缓存优先：从详情 / 新建页切回来时先画上次列表，接口回来后再替换。
  createEffect(() => {
    const pid = activeProjectId()
    setList(pid ? readSpecCache(pid) : null)
  })

  // 接口仍是权威来源；成功后整份替换并写缓存，供下次重挂或 PWA 冷启使用。
  createEffect(() => {
    if (specs.state !== 'ready') return
    const pid = activeProjectId()
    const fresh = specs()
    if (!pid || !fresh) return
    setList(fresh)
    writeSpecCache(pid, fresh)
  })

  createEffect(() => {
    const id = activeProjectId()
    if (!id) return
    const unsub = subscribeSpecsList(id, () => void refetch())
    onCleanup(() => unsub())
  })

  // 长按菜单：菜单本身是页面级单例，只记「当前是哪一条」与「处在哪一段」。
  // 每行各挂一个面板会在长列表上凭空多出几十个 fixed 节点。
  const [menuSpec, setMenuSpec] = createSignal<SpecListItem | null>(null)
  const [confirmingDelete, setConfirmingDelete] = createSignal(false)

  const closeMenu = () => {
    setMenuSpec(null)
    setConfirmingDelete(false)
  }

  const openMenu = (spec: SpecListItem) => {
    setConfirmingDelete(false)
    setMenuSpec(spec)
  }

  const copyPath = async (spec: SpecListItem) => {
    closeMenu()
    const ok = await copyText(specFilePath(spec.id))
    showToast(ok ? t('specs.pathCopied') : t('specs.copyFailed'), ok ? 'default' : 'error')
  }

  const remove = async (spec: SpecListItem) => {
    const pid = activeProjectId()
    if (!pid) return
    closeMenu()
    try {
      await api.deleteSpec(pid, spec.id)
      showToast(t('specs.deleted'))
      // SSE 的 list-updated 也会到，但弱网下会晚一拍，先本地刷一次，
      // 免得菜单都关了、被删的那条还留在列表里。
      await refetch()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const menuItems = (): ActionSheetItem[] => {
    const spec = menuSpec()
    if (!spec) return []
    // 删除不可逆，长按菜单里直接删一次误触就没了，所以拆成两段：
    // 第一段选「删除」只是把面板换成确认段，真正打接口在第二段。
    if (confirmingDelete()) {
      return [
        { label: t('specs.deleteConfirm'), tone: 'destructive', onSelect: () => void remove(spec) },
      ]
    }
    return [
      { label: t('specs.copyPath'), onSelect: () => void copyPath(spec) },
      { label: t('specs.delete'), tone: 'destructive', onSelect: () => setConfirmingDelete(true) },
    ]
  }

  return (
    <Page
      title={t('specs.title')}
      padded={false}
      actions={
        <button
          type="button"
          class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
          aria-label={t('specs.new')}
          onClick={() => navigate('/specs/new')}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      }
    >
      <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
        <Show
          when={list()}
          fallback={
            <Show
              when={!specs.error}
              fallback={<ErrorNotice error={specs.error} onRetry={() => void refetch()} />}
            >
              <LoadingNotice />
            </Show>
          }
        >
          <Show when={(list() ?? []).length > 0} fallback={<Notice title={t('specs.empty')} />}>
            {/* 底色与扩展页列表同口径：卡片色列表浮在稍深的页面底色上。
                  只收 border-b：首行上方紧邻顶栏的 border-b，再加上边框会叠成 2px。 */}
            <ul class="divide-y-[0.5px] divide-border border-b-[0.5px] border-border bg-card">
              <For each={list()}>
                {(spec) => {
                  const parts = splitSpecId(spec.id)
                  const press = createLongPress({
                    onLongPress: () => openMenu(spec),
                    onClick: () => navigate(`/specs/${encodeURIComponent(spec.id)}`),
                  })
                  return (
                    <li>
                      <button
                        type="button"
                        // no-callout + select-none：光拦 contextmenu 拦不住 iOS 的
                        // 长按放大镜与「拷贝/查询」callout
                        class="no-callout flex w-full select-none flex-col gap-1 px-4 py-3 text-left active:bg-accent"
                        {...press}
                      >
                        <span class="flex items-center gap-2">
                          <span
                            class={cn(
                              'rounded border px-1.5 py-0.5 text-[0.65rem] font-medium',
                              stageBadgeClass(spec.stage),
                            )}
                          >
                            {spec.stage}
                          </span>
                          <Show when={parts}>
                            {(p) => (
                              <span
                                class={cn(
                                  'text-[0.65rem] font-medium',
                                  SPEC_TYPE_TEXT[p().type] ?? 'text-muted-foreground',
                                )}
                              >
                                {p().type}
                              </span>
                            )}
                          </Show>
                          <time class="ml-auto shrink-0 text-xs text-muted-foreground">
                            {formatSpecUpdatedAt(spec.updated_at)}
                          </time>
                        </span>
                        <span class="truncate text-sm">{spec.title}</span>
                        <Show when={spec.summary}>
                          {/* 两行截断：一行太少（summary 常是一整句），三行会让每屏只剩四条 */}
                          <span class="line-clamp-2 text-xs text-muted-foreground">
                            {spec.summary}
                          </span>
                        </Show>
                      </button>
                    </li>
                  )
                }}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>

      <ActionSheet
        open={menuSpec() !== null}
        title={menuSpec()?.title || menuSpec()?.id}
        description={confirmingDelete() ? t('specs.deleteHint') : undefined}
        items={menuItems()}
        onClose={closeMenu}
      />
    </Page>
  )
}
