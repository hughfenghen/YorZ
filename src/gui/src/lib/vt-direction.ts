import {
  resolveDirectionByDepth,
  toPathname,
  type ViewTransitionDirection,
} from '@shared/lib/view-transition.js'

/**
 * 桌面端的页面切换方向解析。
 *
 * 桌面端路由都在同一个 `/` 下、没有 base 要剥，路径深度直接对应层级：
 * `/:projectId`（1）→ `/:projectId/specs/:id`（3）是下钻，面包屑回跳是返回，
 * `/:projectA` → `/:projectB`（项目切换）同深度，落在平级。
 */
export function resolveDesktopDirection(
  fromPathname: string,
  to: string | number,
): ViewTransitionDirection | null {
  if (typeof to === 'number') {
    // 浏览器前进后退：0 是原地刷新语义，不做动画
    if (to === 0) return null
    return to < 0 ? 'back' : 'forward'
  }
  return resolveDirectionByDepth(fromPathname, toPathname(to))
}
