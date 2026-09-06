import { Show, type JSX, type ParentComponent } from 'solid-js'
import { X } from 'lucide-solid'
import { t } from '@/i18n/index.js'

/**
 * 通用底部弹层：遮罩 + 贴底卡 + 内部独立滚动。
 *
 * 与 `ActionSheet` 同一套层级/遮罩口径（`z-[60]`，压过 Toast 的 z-50），
 * 区别只在内容：ActionSheet 只接一列动作项，这里接任意 children，
 * 待确认项与追加任务两个表单都装在它里面。
 *
 * `max-h-[85dvh]`：留出顶部一条可见的背景，让人一眼看出这是覆盖层而不是新页面；
 * 用 dvh 而不是 vh，否则 iOS 地址栏收起时卡片会被顶出屏幕。
 * 内部滚动交给 `.scroll-y`（带滚动链隔断），避免弹层滚到底后继续带动身后的正文。
 */
export const Sheet: ParentComponent<{
  open: boolean
  title: string
  onClose: () => void
  /** 贴在卡片底部、不随内容滚动的操作区（提交按钮等）。 */
  footer?: JSX.Element
}> = (props) => (
  <Show when={props.open}>
    <div
      class="fixed inset-0 z-[60] flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
    >
      <button
        type="button"
        class="absolute inset-0 bg-black/40"
        aria-label={t('common.close')}
        onClick={() => props.onClose()}
      />
      <div class="animate-in slide-in-from-bottom-4 relative flex max-h-[85dvh] flex-col rounded-t-2xl bg-card px-safe pb-safe shadow-lg duration-150">
        {/* h-12 与 TopBar 的内容行同高：弹层的头不该比页面的头还重。 */}
        <header class="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <h2 class="min-w-0 flex-1 truncate text-base font-medium">{props.title}</h2>
          <button
            type="button"
            class="tap-target flex shrink-0 items-center justify-center text-muted-foreground active:opacity-60"
            aria-label={t('common.close')}
            onClick={() => props.onClose()}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div class="scroll-y min-h-0 flex-1 px-4 py-3">{props.children}</div>
        <Show when={props.footer}>
          <footer class="shrink-0 border-t border-border px-4 py-3">{props.footer}</footer>
        </Show>
      </div>
    </div>
  </Show>
)
