/**
 * 路由挂载前缀与一级页面归属。
 *
 * `ROUTER_BASE` 必须与 `vite.gui-mobile.config.ts` 的 `base`、以及服务端的挂载
 * 前缀保持一致；这里导出成常量是为了让 `main.tsx` 的 `<Router base>` 和下面的
 * `isTabRoute` 读同一个值——两处各写一遍字面量，改前缀时必然漏掉一处。
 */
export const ROUTER_BASE = '/m'

/** 与 TabBar 一一对应的四个一级页面（不含 base）。 */
export const TAB_PATHS = ['/', '/specs', '/ext', '/projects'] as const

/**
 * 把 `useLocation().pathname` 归一成「不带 base 的应用内路径」。
 *
 * 这一版 solid-router **不会**替我们剥掉 base（`useMatch('/specs')` 同样匹配不上），
 * 所以剥离必须发生在应用侧。导出成公共函数是因为有两个消费方：`isTabRoute`
 * 决定要不要渲染底部导航，`TabBar` 决定哪个 tab 高亮——两边各写一遍必然分叉成
 * 「导航栏显示对了、高亮没跟上」。
 *
 * 同时归一化末尾斜杠：`/m/specs/` → `/specs`，`/m` 与 `/m/` → `/`。
 */
export function stripRouterBase(pathname: string): string {
  const withoutBase = pathname.startsWith(ROUTER_BASE)
    ? pathname.slice(ROUTER_BASE.length)
    : pathname
  return withoutBase.replace(/\/+$/, '') || '/'
}

/**
 * 该路径是否是一级页面（决定要不要渲染底部导航）。
 *
 * 入参是 `useLocation().pathname`，**带着 `ROUTER_BASE` 前缀**；少了
 * `stripRouterBase` 这一步，底部导航会从所有页面上消失。
 */
export function isTabRoute(pathname: string): boolean {
  return (TAB_PATHS as readonly string[]).includes(stripRouterBase(pathname))
}
