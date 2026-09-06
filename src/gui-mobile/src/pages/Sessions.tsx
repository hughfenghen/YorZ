import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js'
import type { Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Plus } from 'lucide-solid'
import { format as formatTimeago, register as registerTimeago } from 'timeago.js'
import zhCNTimeago from 'timeago.js/lib/lang/zh_CN.js'
import { api, type SessionInfo } from '@shared/api/index.js'
import { subscribeSessions } from '@shared/api/sse.js'
import { groupSessions } from '@shared/lib/session-groups.js'
import { enShort } from '@shared/lib/timeago-locale.js'
import { Page } from '@/components/Page.jsx'
import { AgentUsageHint } from '@/components/AgentUsageHint.jsx'
import { ErrorNotice, LoadingNotice, NoProjectNotice, Notice } from '@/components/ListStates.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { readSessionCache, writeSessionCache } from '@/lib/session-cache.js'
import { cn } from '@/lib/cn'
import { t, useTranslation } from '@/i18n/index.js'

// 与桌面端 ChatPanel 用同一套相对时间包：en 走紧凑写法（"5m ago"），
// 否则右对齐的时间列在窄屏上会换行。
registerTimeago('en', enShort)
registerTimeago('zh-CN', zhCNTimeago)

/**
 * Tab1 会话列表。
 *
 * 行的口径与桌面端 ChatPanel 一致：同一个 spec 的多轮 session 由
 * `groupSessions()` 折叠成一行，而不是把每一轮都平铺出来——
 * 后者会让一条正常推进的 spec 在列表里刷出五六行几乎同名的记录。
 */
export const Sessions: Component = () => {
  const { lng } = useTranslation()
  const navigate = useNavigate()

  /**
   * 真正拿去渲染的列表。它有两个来源：本地缓存（立刻）与接口（稍后覆盖）。
   * 单独用一个信号而不是直接读 resource，是为了让「先画缓存、再换权威数据」
   * 这件事只发生在一个地方，SSE 的就地改写也只改这一份。
   */
  const [list, setList] = createSignal<SessionInfo[] | null>(null)

  const [sessions, { refetch }] = createResource<SessionInfo[], string>(
    () => activeProjectId() ?? undefined,
    (pid) => api.listSessions(pid),
  )

  // 缓存优先：项目一确定就把上次的列表画上去，不等网络。
  // 切项目时同样立刻换成那个项目的缓存，避免旧列表挂在新项目名下。
  createEffect(() => {
    const pid = activeProjectId()
    setList(pid ? readSessionCache(pid) : null)
  })

  // 接口是权威：ready 之后整份替换，并写回缓存供下次冷启使用。
  // 用 state 而不是 loading 判定：resource 处于 errored 时读值会抛，
  // 而 'ready' 同时排除了 pending / refreshing（切项目那一瞬的旧值）。
  createEffect(() => {
    if (sessions.state !== 'ready') return
    const pid = activeProjectId()
    const fresh = sessions()
    if (!pid || !fresh) return
    setList(fresh)
    writeSessionCache(pid, fresh)
  })

  // SSE 只推「某个 session 的 running 变了」，不推全量列表；
  // 就地改这一个字段，避免每次状态跳动都整表重拉。
  // 订阅跟着活动项目走：切项目时 createEffect 重跑，onCleanup 关掉上一条。
  createEffect(() => {
    const id = activeProjectId()
    if (!id) return
    const unsub = subscribeSessions(id, {
      onStatus: (e) => {
        setList((prev) =>
          prev
            ? prev.map((item) => (item.id === e.sessionId ? { ...item, running: e.running } : item))
            : prev,
        )
      },
    })
    onCleanup(() => unsub())
  })

  const groups = createMemo(() => {
    const items = list()
    if (!items) return []
    return groupSessions(items, (sid) => items.find((s) => s.id === sid)?.running === true)
  })

  return (
    <Page
      title={t('sessions.title')}
      padded={false}
      actions={
        <button
          type="button"
          class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
          aria-label={t('sessions.new')}
          onClick={() => navigate('/sessions/new')}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      }
    >
      <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
        {/* 有数据（哪怕来自缓存）就一律先画列表：加载态与错误页只在真的
            无内容可展示时才顶上来，否则每次冷启都要白屏等一发网络。 */}
        <Show
          when={list()}
          fallback={
            <Show
              when={!sessions.error}
              fallback={<ErrorNotice error={sessions.error} onRetry={() => void refetch()} />}
            >
              <LoadingNotice />
            </Show>
          }
        >
          <Show
            when={groups().length > 0}
            fallback={<Notice title={t('sessions.empty')} action={<AgentUsageHint />} />}
          >
            <ul class="divide-y divide-border">
              <For each={groups()}>
                {(group) => (
                  <li>
                    <button
                      type="button"
                      class="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent"
                      // 组里最新的一轮就是「这条 spec 现在在跑的那次对话」；
                      // 会话详情自己会按 specId 把整组历史聚合出来。
                      onClick={() => navigate(`/sessions/${encodeURIComponent(group.latest.id)}`)}
                    >
                      {/* 运行状态点占固定槽位：不运行时也留位，否则标题会左右跳动 */}
                      <span
                        class={cn(
                          'size-2 shrink-0 rounded-full',
                          group.running ? 'bg-primary animate-pulse' : 'bg-muted-foreground/40',
                        )}
                        aria-label={group.running ? t('sessions.running') : undefined}
                      />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm">{group.latest.title}</span>
                        <span class="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <time>{formatTimeago(group.updatedAt, lng())}</time>
                          <span>·</span>
                          <span>{group.latest.kind}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>
    </Page>
  )
}
