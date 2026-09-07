import { createEffect, createRoot } from 'solid-js'

/**
 * 两端共用的「页面切换过渡」机制层（桌面端 src/gui + 移动端 src/gui-mobile）。
 *
 * 这里只放平台无关、且**不依赖 solid-router** 的部分：方向推断、特性检测、
 * 过渡的启动与收尾。路由拦截那一半在 `view-transition-nav.ts`——拆开是因为
 * `@solidjs/router` 在 node 环境下 import 即抛「Client-only API called on the
 * server side」，而下面这些纯函数需要能在 vitest（environment: node）里直接测。
 *
 * 动画本身（时长、缓动、位移方向）由两端各自的 app.css 决定，两者靠下面两个
 * 常量约定的「CSS 契约」对接。
 */

/**
 * 页面承载节点的 `view-transition-name`。
 *
 * 两端 app.css 里各有一条 `.vt-page { view-transition-name: page }`，值必须与
 * 此常量一致；同一时刻全文档只能有一个元素用这个名字，两端各自的 `<main>`
 * 天然满足（AppShell 里那一个节点跨路由持久存在，只有子树被替换）。
 */
export const VT_PAGE_NAME = 'page'

/**
 * 过渡期间写在 `<html>` 上的方向标记，CSS 侧按 `html[data-vt='forward']` 之类
 * 选择动画。改名要同步两端 app.css。
 */
export const VT_DIRECTION_ATTR = 'data-vt'

/** 页面切换的三种语义方向。 */
export type ViewTransitionDirection = 'forward' | 'back' | 'lateral'

/**
 * 方向解析器：返回 `null` 表示「这次切换不做动画」，给两端留显式豁免口子。
 * `to` 与 `beforeLeave` 的语义一致——字符串是已解析的绝对路径，数字是历史步进。
 */
export type ViewTransitionDirectionResolver = (
  fromPathname: string,
  to: string | number,
) => ViewTransitionDirection | null

/** 浏览器是否支持 View Transition（Chrome 111+ / Safari 18+；Firefox 目前没有）。 */
export function supportsViewTransition(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
}

/**
 * 用户是否要求减弱动态效果。每次现读而不是缓存：系统设置可以在页面存活期间改，
 * 缓存住会让用户改完还得刷新才生效。
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 路径的层级深度：`/specs/x/git` → 3，`/` → 0。 */
export function pathDepth(pathname: string): number {
  return pathname.split('/').filter(Boolean).length
}

/**
 * 按路径段深度推断方向。
 *
 * 之所以不看 history：两端的「返回」都是显式 `navigate('/目标')` 或面包屑链接，
 * 在 history 里是 push 而非 pop（移动端这么做是因为 PWA 冷启进二级页时
 * `history.back()` 会直接退出应用），delta 在这里没有信息量。
 */
export function resolveDirectionByDepth(
  fromPathname: string,
  toPathname: string,
): ViewTransitionDirection {
  const from = pathDepth(fromPathname)
  const to = pathDepth(toPathname)
  if (to > from) return 'forward'
  if (to < from) return 'back'
  return 'lateral'
}

/** 把 `beforeLeave` 给的字符串目标解析成 pathname（它可能带 search / hash）。 */
export function toPathname(to: string): string {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  try {
    return new URL(to, origin).pathname
  } catch {
    // 解析不了就退回原串（只可能是异常输入；宁可方向判不准也不要抛错阻断导航）
    return to
  }
}

/**
 * 等待谓词成立，带超时兜底。
 *
 * 兜底是硬要求：谓词永不成立时（例如历史步进落回同一个 pathname）不能把过渡
 * 永久挂起——导航本身早已被 `retry` 放行，卡住的只有动画。
 */
export function waitFor(pred: () => boolean, timeoutMs = 600): Promise<void> {
  if (pred()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    let dispose: (() => void) | undefined
    const timer = setTimeout(finish, timeoutMs)
    function finish(): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      dispose?.()
      resolve()
    }
    createRoot((d) => {
      dispose = d
      createEffect(() => {
        if (pred()) finish()
      })
    })
    // createRoot 是同步的，但 effect 排在微任务队列里；若谓词此刻已成立，
    // 上面的 effect 会立刻收敛，不需要额外处理。
  })
}

/** 当前在途的过渡。连发导航时先跳过旧的，避免两段动画叠在一起。 */
let current: ViewTransition | null = null

/**
 * 起一次带方向标记的视图过渡。
 *
 * `update` 必须在其 promise resolve 之前完成 DOM 更新——这正是
 * `createViewTransitionNav` 里「retry 之后等路由提交」那段的职责。
 */
export function runViewTransition(
  direction: ViewTransitionDirection,
  update: () => Promise<void> | void,
): void {
  const root = document.documentElement
  current?.skipTransition()
  root.setAttribute(VT_DIRECTION_ATTR, direction)
  const transition = document.startViewTransition(async () => {
    await update()
  })
  current = transition
  void transition.finished
    .catch(() => {
      // 被 skipTransition 打断会走到这里，属正常路径，不上报
    })
    .finally(() => {
      if (current === transition) {
        current = null
        // 只有最后一个过渡负责清属性：连发时前一个的 finally 会晚于后一个开始，
        // 提前清掉会让正在播的动画丢方向。
        root.removeAttribute(VT_DIRECTION_ATTR)
      }
    })
}

/**
 * 一次导航该不该做过渡。抽成纯函数是为了能单测这几条跳过条件——
 * 真正的拦截在 `view-transition-nav.ts`，那里没法脱离 router 运行。
 *
 * 跳过条件（任一命中就原样放行，行为与接入前完全一致）：
 * 1. 已有别的监听器拦截了这次导航（不抢）；
 * 2. 浏览器不支持，或用户要求减弱动态效果；
 * 3. `replace: true`——同页 URL 回填与首屏重定向，动画只会是闪烁；
 * 4. 目标 pathname 与当前相同（只改了 search / hash，例如列表分页）；
 * 5. 解析器返回 `null`（两端自定的豁免）。
 */
export function decideDirection(
  input: {
    fromPathname: string
    to: string | number
    replace?: boolean
    defaultPrevented?: boolean
    enabled?: boolean
  },
  resolveDirection: ViewTransitionDirectionResolver,
): ViewTransitionDirection | null {
  if (input.defaultPrevented) return null
  if (input.enabled === false) return null
  if (input.replace) return null
  if (typeof input.to === 'string' && toPathname(input.to) === input.fromPathname) return null
  return resolveDirection(input.fromPathname, input.to)
}
