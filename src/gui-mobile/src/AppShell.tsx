import type { ParentComponent } from 'solid-js'
import { StatusBanner } from './components/StatusBanner.jsx'
import { TabBar } from './components/TabBar.jsx'
import { Toaster } from './components/Toast.jsx'
import { watchNetwork } from './lib/network.js'

/**
 * 应用外壳：状态横幅 / 路由内容 / 底部导航三段式。
 *
 * 高度链条是 #app(100dvh, flex-col) → main(flex-1 min-h-0) → 页面内部滚动容器，
 * 中间任何一环少了 min-h-0 都会让内容把底部导航顶出视口，这在移动端等于导航消失。
 */
export const AppShell: ParentComponent = (props) => {
  // 在组件作用域内调用：内部用 onCleanup 注销监听，放到 onMount 里也行，
  // 但没有必要——注册本身不碰 DOM 布局。
  watchNetwork()

  return (
    <>
      <StatusBanner />
      <main class="flex min-h-0 flex-1 flex-col">{props.children}</main>
      <TabBar />
      {/* 单例 toast，fixed 定位浮在导航之上，不参与上面的高度链条 */}
      <Toaster />
    </>
  )
}
