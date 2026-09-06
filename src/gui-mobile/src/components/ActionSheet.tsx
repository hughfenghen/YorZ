import { For, Show, createEffect, type Component } from 'solid-js'
import { cn } from '@/lib/cn'
import { t } from '@/i18n/index.js'

export interface ActionSheetItem {
  label: string
  tone?: 'default' | 'destructive'
  onSelect: () => void
}

interface ActionSheetProps {
  open: boolean
  /** 面板标题，通常是被操作对象的名字。 */
  title?: string
  /** 二次确认时的说明文案。 */
  description?: string
  items: ActionSheetItem[]
  onClose: () => void
}

/**
 * 底部动作面板：遮罩 + 贴底卡片 + 固定的「取消」。
 *
 * 移动端没有右键，长按是唯一的「更多操作」入口，长按之后需要一个明确的落点——
 * 桌面端那套 Kobalte DropdownMenu 依赖指针悬浮与精确点击，搬过来在拇指操作下并不好用。
 *
 * 同一个组件也承担二次确认：调用方把 `items` 换成单条 destructive 项、
 * 把 `description` 设成风险说明即可，不必再引入一个 Dialog 组件。
 */
export const ActionSheet: Component<ActionSheetProps> = (props) => {
  // 长按松手产生的那次 click，在部分浏览器上会落到刚渲染出来的遮罩上，
  // 面板于是「刚弹出就被自己关掉」。开局 300ms 内不理会遮罩点击。
  let openedAt = 0
  createEffect(() => {
    if (props.open) openedAt = Date.now()
  })

  const closeFromOverlay = () => {
    if (Date.now() - openedAt < 300) return
    props.onClose()
  }

  return (
    <Show when={props.open}>
      <div
        // z 比 Toast（z-50）高一档：上一条还没消失的提示会浮在底部，
        // 同层的话会正好盖住面板最下面那个动作项
        class="fixed inset-0 z-[60] flex flex-col justify-end px-safe pb-safe"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          class="absolute inset-0 bg-black/40"
          aria-label={t('common.cancel')}
          onClick={closeFromOverlay}
        />
        <div class="animate-in slide-in-from-bottom-4 relative p-2 duration-150">
          <div class="overflow-hidden rounded-xl bg-card shadow-lg">
            <Show when={props.title || props.description}>
              <div class="border-b border-border px-4 py-3 text-center">
                <Show when={props.title}>
                  <p class="truncate text-sm font-medium">{props.title}</p>
                </Show>
                <Show when={props.description}>
                  <p class="mt-1 text-xs text-muted-foreground">{props.description}</p>
                </Show>
              </div>
            </Show>
            <div class="divide-y divide-border">
              <For each={props.items}>
                {(item) => (
                  <button
                    type="button"
                    class={cn(
                      'flex h-12 w-full items-center justify-center text-sm active:bg-accent',
                      item.tone === 'destructive' && 'text-destructive',
                    )}
                    onClick={() => item.onSelect()}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <button
            type="button"
            class="mt-2 flex h-12 w-full items-center justify-center rounded-xl bg-card text-sm font-medium shadow-lg active:bg-accent"
            onClick={() => props.onClose()}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Show>
  )
}
