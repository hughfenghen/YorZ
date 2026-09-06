import { describe, expect, it } from 'vitest'
import { ROUTER_BASE, isTabRoute } from '../routes.js'

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
