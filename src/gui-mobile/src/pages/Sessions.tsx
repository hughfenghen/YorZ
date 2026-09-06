import { For, Show, createEffect, createMemo, createResource, onCleanup } from 'solid-js'
import type { Component } from 'solid-js'
import { Plus } from 'lucide-solid'
import { format as formatTimeago, register as registerTimeago } from 'timeago.js'
import zhCNTimeago from 'timeago.js/lib/lang/zh_CN.js'
import { api, type SessionInfo } from '@shared/api/index.js'
import { subscribeSessions } from '@shared/api/sse.js'
import { groupSessions } from '@shared/lib/session-groups.js'
import { enShort } from '@shared/lib/timeago-locale.js'
import { Page } from '@/components/Page.jsx'
import {
  ErrorNotice,
  LoadingNotice,
  NoProjectNotice,
  Notice,
  comingSoon,
} from '@/components/ListStates.jsx'
import { activeProjectId } from '@/lib/active-project.js'
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
  const [sessions, { refetch, mutate }] = createResource<SessionInfo[], string>(
    () => activeProjectId() ?? undefined,
    (pid) => api.listSessions(pid),
  )

  // SSE 只推「某个 session 的 running 变了」，不推全量列表；
  // 就地改这一个字段，避免每次状态跳动都整表重拉。
  // 订阅跟着活动项目走：切项目时 createEffect 重跑，onCleanup 关掉上一条。
  createEffect(() => {
    const id = activeProjectId()
    if (!id) return
    const unsub = subscribeSessions(id, {
      onStatus: (e) => {
        mutate((prev) =>
          prev?.map((item) => (item.id === e.sessionId ? { ...item, running: e.running } : item)),
        )
      },
    })
    onCleanup(() => unsub())
  })

  const groups = createMemo(() => {
    const list = sessions()
    if (!list) return []
    return groupSessions(list, (sid) => list.find((s) => s.id === sid)?.running === true)
  })

  return (
    <Page
      title={t('sessions.title')}
      padded={false}
      actions={
        <button
          type="button"
          class="tap-target -mr-2 flex items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          aria-label={t('sessions.new')}
          onClick={comingSoon}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      }
    >
      <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
        <Show when={!sessions.loading} fallback={<LoadingNotice />}>
          <Show
            when={!sessions.error}
            fallback={<ErrorNotice error={sessions.error} onRetry={() => void refetch()} />}
          >
            <Show when={groups().length > 0} fallback={<Notice title={t('sessions.empty')} />}>
              <ul class="divide-y divide-border">
                <For each={groups()}>
                  {(group) => (
                    <li>
                      <button
                        type="button"
                        class="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent"
                        onClick={comingSoon}
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
      </Show>
    </Page>
  )
}
