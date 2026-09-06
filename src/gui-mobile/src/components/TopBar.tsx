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
 */
export const TopBar: Component<TopBarProps> = (props) => (
  <header class="shrink-0 border-b border-border bg-card px-safe pt-safe">
    <div class="flex h-12 items-center gap-2 px-4">
      <Show when={props.onBack}>
        <button
          type="button"
          class="tap-target -ml-3 flex shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent"
          aria-label={props.title}
          onClick={() => props.onBack?.()}
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
      </Show>
      <h1 class="min-w-0 flex-1 truncate text-base font-medium">{props.title}</h1>
      <Show when={props.actions}>
        <div class="flex shrink-0 items-center gap-1">{props.actions}</div>
      </Show>
    </div>
  </header>
)
