import { Show, type Component, type JSX } from 'solid-js'
import { ChevronLeft } from 'lucide-solid'

interface TopBarProps {
  title: string
  /** 右侧动作区（图标按钮等）。 */
  actions?: JSX.Element
  /** 二级页面的返回动作；给了才渲染左侧返回键。 */
  onBack?: () => void
}

/**
 * 顶栏：只承载标题与页面级动作。
 * pt-safe 把刘海区域算进内边距，标题不会被状态栏压住——
 * index.html 用了 viewport-fit=cover，安全区必须由内容自己处理。
 *
 * 三槽布局：左右两个槽位都是 `min-w-0 flex-1`（flex-basis:0 + grow:1），
 * 无论里面有没有按钮都分到相同宽度，标题因此落在几何中心且仍可 truncate。
 * 没有用 `absolute left-1/2 -translate-x-1/2`：绝对定位后标题脱离流，
 * 最大宽度只能靠硬编码 padding 猜测两侧按钮个数，多一个动作按钮就会重叠。
 */
export const TopBar: Component<TopBarProps> = (props) => (
  <header class="shrink-0 border-b border-border bg-card px-safe pt-safe">
    <div class="flex h-12 items-center gap-2 px-4">
      <div class="flex min-w-0 flex-1 items-center justify-start">
        <Show when={props.onBack}>
          <button
            type="button"
            // -ml-2 与动作按钮的 -mr-2 同一口径：两侧图标中心距屏幕边缘等距
            class="tap-target -ml-2 flex shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
            aria-label={props.title}
            onClick={() => props.onBack?.()}
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
        </Show>
      </div>
      <h1 class="min-w-0 truncate text-base font-medium">{props.title}</h1>
      <div class="flex min-w-0 flex-1 items-center justify-end gap-1">{props.actions}</div>
    </div>
  </header>
)
