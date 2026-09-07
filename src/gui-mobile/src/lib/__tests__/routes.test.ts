import { describe, expect, it } from 'vitest'
import { ROUTER_BASE, isTabRoute, stripRouterBase } from '../routes.js'

describe('stripRouterBase', () => {
  // 回归点：useLocation().pathname 带着 `/m` 前缀，TabBar 直接拿它比对 href 时
  // 四个 tab 永远不高亮（`/m` !== `/`）。剥离逻辑与 isTabRoute 共用同一份。
  it('剥掉 base 前缀', () => {
    expect(stripRouterBase(`${ROUTER_BASE}/specs`)).toBe('/specs')
    expect(stripRouterBase(`${ROUTER_BASE}/sessions/abc-123`)).toBe('/sessions/abc-123')
  })

  it('base 自身与其末尾斜杠都归一到根路径', () => {
    expect(stripRouterBase(ROUTER_BASE)).toBe('/')
    expect(stripRouterBase(`${ROUTER_BASE}/`)).toBe('/')
  })

  it('去掉末尾斜杠', () => {
    expect(stripRouterBase(`${ROUTER_BASE}/specs/`)).toBe('/specs')
    expect(stripRouterBase('/projects/')).toBe('/projects')
  })

  it('没有 base 前缀时按原样返回', () => {
    expect(stripRouterBase('/specs')).toBe('/specs')
    expect(stripRouterBase('/')).toBe('/')
  })
})

describe('isTabRoute', () => {
  // 这是回归测试：第一版直接拿裸路径比对，而 useLocation().pathname 带着
  // `/m` 前缀，结果四个一级页面全部判成二级页，底部导航从整个应用消失。
  it('四个一级页面（带 base 前缀）都算 tab 路由', () => {
    for (const path of ['/', '/specs', '/ext', '/projects']) {
      expect(isTabRoute(`${ROUTER_BASE}${path}`)).toBe(true)
    }
  })

  it('末尾斜杠不影响归属', () => {
    expect(isTabRoute(`${ROUTER_BASE}/specs/`)).toBe(true)
    expect(isTabRoute(`${ROUTER_BASE}/`)).toBe(true)
  })

  it('二级页面不算', () => {
    for (const path of [
      '/sessions/new',
      '/sessions/abc-123',
      '/specs/new',
      '/specs/260906.feat.demo',
      '/settings/global',
      '/settings/project',
    ]) {
      expect(isTabRoute(`${ROUTER_BASE}${path}`)).toBe(false)
    }
  })

  it('前缀相同但更深的路径不算：/specs/x 不是 /specs', () => {
    expect(isTabRoute(`${ROUTER_BASE}/specsomething`)).toBe(false)
    expect(isTabRoute(`${ROUTER_BASE}/projects/1`)).toBe(false)
  })

  it('没有 base 前缀时按原样判定，不误伤', () => {
    expect(isTabRoute('/specs')).toBe(true)
    expect(isTabRoute('/specs/abc')).toBe(false)
  })
})

describe('tab 高亮判定', () => {
  // TabBar.isActive 的判定规则，在这里以纯函数形式固化：组件里只是同一行的
  // JSX 包装。回归点同上——少了 stripRouterBase，四个 tab 全部不亮。
  const isActive = (pathname: string, href: string, end: boolean): boolean => {
    const path = stripRouterBase(pathname)
    return end ? path === href : path.startsWith(href)
  }

  it('四个一级页面各自只高亮自己那个 tab', () => {
    expect(isActive(`${ROUTER_BASE}/`, '/', true)).toBe(true)
    expect(isActive(`${ROUTER_BASE}/specs`, '/specs', false)).toBe(true)
    expect(isActive(`${ROUTER_BASE}/ext`, '/ext', false)).toBe(true)
    expect(isActive(`${ROUTER_BASE}/projects`, '/projects', false)).toBe(true)
  })

  it('会话 tab 精确匹配，不会在其它页面上一起亮', () => {
    expect(isActive(`${ROUTER_BASE}/specs`, '/', true)).toBe(false)
    expect(isActive(`${ROUTER_BASE}/projects`, '/', true)).toBe(false)
  })

  it('二级页面仍高亮所属 tab', () => {
    expect(isActive(`${ROUTER_BASE}/specs/260906.feat.demo`, '/specs', false)).toBe(true)
    expect(isActive(`${ROUTER_BASE}/ext/scripts`, '/ext', false)).toBe(true)
  })
})
