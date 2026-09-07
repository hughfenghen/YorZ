import { useBeforeLeave, useIsRouting, useLocation } from '@solidjs/router'
import type { BeforeLeaveEventArgs } from '@solidjs/router'
import {
  decideDirection,
  prefersReducedMotion,
  runViewTransition,
  supportsViewTransition,
  waitFor,
  type ViewTransitionDirectionResolver,
} from './view-transition.js'

/**
 * 把 View Transition 接到 solid-router 上（桌面端与移动端共用）。
 *
 * 与 `view-transition.ts` 分家的原因：`@solidjs/router` 在 node 环境下 import
 * 即抛「Client-only API called on the server side」，同文件会让那边的纯函数
 * 没法在 vitest 里直接测。这里只留跑在浏览器里的那一半。
 *
 * ## 为什么拦在 useBeforeLeave
 *
 * solid-router 的三类导航——`<A>` 点击、程序化 `navigate()`、浏览器/系统的
 * 前进后退（popstate）——最终都汇合到 `beforeLeave.confirm()`。在这里注册一次
 * 就全覆盖，不必去改几十个调用点，新增页面也零成本。
 *
 * ## 为什么必须「先拦下、再在更新回调里放行」
 *
 * `document.startViewTransition(cb)` 的时序是：捕获旧快照 → 执行 `cb` →
 * 等 `cb` 的 promise resolve → 捕获新快照 → 播动画。而 solid-router 的提交在
 * 没有异步资源时是**同步**发生的。若只是「顺手起一个过渡、不拦导航」，DOM 会在
 * 旧快照捕获之前就换掉，旧快照拍到的是新页面，动画退化成「新页面淡入新页面」。
 * 所以只能：`preventDefault()` 拦下 → 起过渡 → 在更新回调里 `retry(true)` 放行
 * → 等提交完成再 resolve。
 */
export function createViewTransitionNav(opts: {
  resolveDirection: ViewTransitionDirectionResolver
}): void {
  const location = useLocation()
  const isRouting = useIsRouting()

  useBeforeLeave((e: BeforeLeaveEventArgs) => {
    const from = location.pathname
    const direction = decideDirection(
      {
        fromPathname: from,
        to: e.to,
        replace: e.options?.replace,
        defaultPrevented: e.defaultPrevented,
        // 现读而不是在注册时算一次：用户可能中途改系统的「减弱动态效果」
        enabled: supportsViewTransition() && !prefersReducedMotion(),
      },
      opts.resolveDirection,
    )
    if (!direction) return

    const isTraversal = typeof e.to === 'number'
    e.preventDefault()
    runViewTransition(direction, async () => {
      // force=true 置上 router 内部的 ignore 标志，重放这次导航时不会再次进入
      // 本监听器，否则就是死循环。
      e.retry(true)
      if (isTraversal) {
        // 历史步进走的是 history.go()，DOM 提交发生在后续的 popstate 任务里，
        // 此刻 isRouting 还是 false，只等它会立即 resolve 并拍到旧 DOM。
        await waitFor(() => location.pathname !== from)
      }
      await waitFor(() => !isRouting())
    })
  })
}
