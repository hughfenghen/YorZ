import { Show, type Component, type JSX } from 'solid-js'
import { ChevronLeft } from 'lucide-solid'

interface TopBarProps {
  title: string
  /** 右侧动作区（图标按钮等）。 */
  actions?: JSX.Element
  /**
   * 返回键右侧、标题左侧的槽位。
   *
   * spec 详情跳会话的入口按设计稿画在左上角，与会话详情跳 spec 的右上角
   * 刻意不对称——两个方向由位置区分，用户不必读图标就知道去哪。
   */
  leading?: JSX.Element
  /** 二级页面的返回动作；给了才渲染左侧返回键。 */
  onBack?: () => void
}

/**
 * 顶栏：只承载标题与页面级动作。
 * pt-safe 把刘海区域算进内边距，标题不会被状态栏压住——
 * index.html 用了 viewport-fit=cover，安全区必须由内容自己处理。
 *
 * 三槽布局：左右两个槽位都是 `flex-1`（flex-basis:0 + grow:1），无论里面有没有
 * 按钮都分到相同宽度，标题因此落在几何中心且仍可 truncate。
 * 没有用 `absolute left-1/2 -translate-x-1/2`：绝对定位后标题脱离流，
 * 最大宽度只能靠硬编码 padding 猜测两侧按钮个数，多一个动作按钮就会重叠。
 *
 * 侧槽刻意**不加** `min-w-0`：那会允许它们收缩到 0，长标题（spec 详情的标题就是
 * 一整条 spec id）便把两侧挤没，图标溢出到标题底下互相压字。保留默认的
 * `min-width:auto`，收缩压力就落到带 `min-w-0 truncate` 的标题上——该截断的是
 * 标题，不是按钮。
 *
 * 侧槽用 `gap-3`：图标按钮视觉 20×20、命中区靠 `.tap-target` 的伪元素各向外扩
 * 12px，间距正好是 12px 时两枚图标的命中区相接而不重叠（见 app.css）。
 */
export const TopBar: Component<TopBarProps> = (props) => (
  <header class="shrink-0 border-b border-border bg-card px-safe pt-safe">
    <div class="flex h-12 items-center gap-3 px-4">
      <div class="flex flex-1 items-center justify-start gap-3">
        <Show when={props.onBack}>
          <button
            type="button"
            class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
            aria-label={props.title}
            onClick={() => props.onBack?.()}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
        </Show>
        {props.leading}
      </div>
      <h1 class="min-w-0 truncate text-base font-medium">{props.title}</h1>
      <div class="flex flex-1 items-center justify-end gap-3">{props.actions}</div>
    </div>
  </header>
)
