import {
  resolveDirectionByDepth,
  toPathname,
  type ViewTransitionDirection,
} from '@shared/lib/view-transition.js'
import { isTabRoute, stripRouterBase } from './routes.js'

/**
 * 移动端的页面切换方向解析。
 *
 * 两点平台特有的处理：
 *
 * 1. **先剥 base**。`useLocation().pathname` 带着 `/m` 前缀，这一版 solid-router
 *    不替我们剥；不剥的话所有路径深度都多算一级，虽然相对关系不变，但下面的
 *    tab 判定会整体失配。
 * 2. **四个一级页面互切固定判平级**。`/`（深度 0）与 `/specs`（深度 1）按深度
 *    规则会被判成下钻，而底部导航之间明明是同级平移。
 */
export function resolveMobileDirection(
  fromPathname: string,
  to: string | number,
): ViewTransitionDirection | null {
  if (typeof to === 'number') {
    // 浏览器 / 系统的前进后退（PWA 里主要是系统边缘手势）
    if (to === 0) return null
    return to < 0 ? 'back' : 'forward'
  }
  const from = stripRouterBase(fromPathname)
  const target = stripRouterBase(toPathname(to))
  if (isTabRoute(from) && isTabRoute(target)) return 'lateral'
  return resolveDirectionByDepth(from, target)
}
