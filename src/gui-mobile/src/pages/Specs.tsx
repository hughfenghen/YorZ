import { For, Show, createEffect, createResource, onCleanup, type Component } from 'solid-js'
import { Plus } from 'lucide-solid'
import { api, type SpecListItem } from '@shared/api/index.js'
import { subscribeSpecsList } from '@shared/api/sse.js'
import { SPEC_TYPE_TEXT, splitSpecId, stageBadgeClass } from '@shared/lib/spec-meta.js'
import { formatSpecUpdatedAt } from '@shared/lib/time.js'
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
  const [specs, { refetch }] = createResource<SpecListItem[], string>(
    () => activeProjectId() ?? undefined,
    (pid) => api.listSpecs(pid),
  )

  createEffect(() => {
    const id = activeProjectId()
    if (!id) return
    const unsub = subscribeSpecsList(id, () => void refetch())
    onCleanup(() => unsub())
  })

  return (
    <Page
      title={t('specs.title')}
      padded={false}
      actions={
        <button
          type="button"
          class="tap-target -mr-2 flex items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          aria-label={t('specs.new')}
          onClick={comingSoon}
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      }
    >
      <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
        <Show when={!specs.loading} fallback={<LoadingNotice />}>
          <Show
            when={!specs.error}
            fallback={<ErrorNotice error={specs.error} onRetry={() => void refetch()} />}
          >
            <Show when={(specs() ?? []).length > 0} fallback={<Notice title={t('specs.empty')} />}>
              <ul class="divide-y divide-border">
                <For each={specs()}>
                  {(spec) => {
                    const parts = splitSpecId(spec.id)
                    return (
                      <li>
                        <button
                          type="button"
                          class="flex w-full flex-col gap-1 px-4 py-3 text-left active:bg-accent"
                          onClick={comingSoon}
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
      </Show>
    </Page>
  )
}
