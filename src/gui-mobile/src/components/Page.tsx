import type { JSX, ParentComponent } from 'solid-js'
import { TopBar } from './TopBar.jsx'

interface PageProps {
  title: string
  actions?: JSX.Element
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
    <TopBar title={props.title} actions={props.actions} />
    <div class="scroll-y min-h-0 flex-1 px-safe">
      <div class="px-4 py-4">{props.children}</div>
    </div>
  </>
)
