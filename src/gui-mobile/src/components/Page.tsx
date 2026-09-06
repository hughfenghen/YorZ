import type { JSX, ParentComponent } from 'solid-js'
import { TopBar } from './TopBar.jsx'

interface PageProps {
  title: string
  actions?: JSX.Element
  /** 透传给 TopBar 的左侧槽位（返回键右侧）。 */
  leading?: JSX.Element
  /**
   * 贴在滚动区之下的常驻栏（会话详情的输入栏）。
   *
   * 放在 Page 而不是由页面自己 fixed：fixed 元素脱离 flex 流，滚动区就不知道
   * 该给底部留多少空间，最后一条消息永远压在输入栏下面。
   */
  footer?: JSX.Element
  /**
   * 内容区是否套默认的 px-4 py-4。列表页传 false：行分隔线要通条贯穿，
   * 左右留白由行自己给，否则分隔线两端会缺一块。
   */
  padded?: boolean
  /** 二级页面的返回动作，透传给 TopBar。 */
  onBack?: () => void
  /**
   * 拿到滚动容器本身。会话详情要读 scrollTop/scrollHeight 判断「贴底」，
   * spec 详情要在它上面做文件链接的事件委托——两者都够不到 Page 内部的 div。
   */
  scrollRef?: (el: HTMLDivElement) => void
  onScroll?: (e: Event) => void
}

/**
 * 页面骨架：顶栏固定，内容区独立滚动。
 *
 * 滚动必须发生在这一层而不是 body：body 在 app.css 里被锁成 overflow:hidden，
 * 否则 iOS 会把整页橡皮筋叠加在内部滚动上。`min-h-0` 是 flex 子项能收缩的前提，
 * 少了它内容区会撑破容器、把底部导航顶出屏幕。
 */
export const Page: ParentComponent<PageProps> = (props) => (
  <>
    <TopBar
      title={props.title}
      actions={props.actions}
      leading={props.leading}
      onBack={props.onBack}
    />
    <div class="scroll-y min-h-0 flex-1 px-safe" ref={props.scrollRef} onScroll={props.onScroll}>
      <div class={props.padded === false ? '' : 'px-4 py-4'}>{props.children}</div>
    </div>
    {props.footer}
  </>
)
