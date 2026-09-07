import { Show, type ParentComponent } from 'solid-js'
import { useLocation } from '@solidjs/router'
import { createViewTransitionNav } from '@shared/lib/view-transition-nav.js'
import { StatusBanner } from './components/StatusBanner.jsx'
import { TabBar } from './components/TabBar.jsx'
import { Toaster } from './components/Toast.jsx'
import { watchNetwork } from './lib/network.js'
import { isTabRoute } from './lib/routes.js'
import { resolveMobileDirection } from './lib/vt-direction.js'

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

  // 路由切换套上 View Transition：拦在 beforeLeave 这一个点上，
  // 链接点击 / 程序化 navigate / 系统前进后退全覆盖，页面组件不用感知。
  createViewTransitionNav({ resolveDirection: resolveMobileDirection })

  const location = useLocation()

  return (
    <>
      <StatusBanner />
      {/* vt-page 把这个节点从 root 快照里独立出来，切页时只有它动，
          状态横幅与底部导航留在 root 里（见 app.css 的 View Transition 段） */}
      <main class="vt-page flex min-h-0 flex-1 flex-col">{props.children}</main>
      {/*
        二级页面不出底部导航：它们都带返回键，再留一条 tab 栏既抢走 56px 高度，
        又与「返回」的层级语义打架；会话详情底部本来就是输入栏，两条底栏叠在
        小屏上不可接受。两个设置页同属二级页，一并按此口径处理。
      */}
      <Show when={isTabRoute(location.pathname)}>
        <TabBar />
      </Show>
      {/* 单例 toast，fixed 定位浮在导航之上，不参与上面的高度链条 */}
      <Toaster />
    </>
  )
}
