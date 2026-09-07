import { describe, expect, it } from 'vitest'
import { decideDirection, pathDepth, resolveDirectionByDepth } from '@shared/lib/view-transition.js'
import { resolveDesktopDirection } from '../vt-direction.js'

describe('pathDepth', () => {
  it('counts non-empty segments', () => {
    expect(pathDepth('/')).toBe(0)
    expect(pathDepth('/proj')).toBe(1)
    expect(pathDepth('/proj/specs/abc')).toBe(3)
    // 末尾斜杠与重复斜杠不该多算一级
    expect(pathDepth('/proj/specs/')).toBe(2)
  })
})

describe('resolveDirectionByDepth', () => {
  it('maps deeper / shallower / same depth to the three directions', () => {
    expect(resolveDirectionByDepth('/proj', '/proj/specs/abc')).toBe('forward')
    expect(resolveDirectionByDepth('/proj/specs/abc', '/proj')).toBe('back')
    expect(resolveDirectionByDepth('/projA', '/projB')).toBe('lateral')
  })
})

describe('resolveDesktopDirection', () => {
  it('treats drilling into a spec as forward', () => {
    expect(resolveDesktopDirection('/proj', '/proj/specs/abc')).toBe('forward')
    expect(resolveDesktopDirection('/proj/specs/abc', '/proj/specs/abc/review')).toBe('forward')
  })

  it('treats breadcrumb jumps back as back', () => {
    // 面包屑在 history 里是 push，方向只能靠深度推
    expect(resolveDesktopDirection('/proj/specs/abc', '/proj')).toBe('back')
    expect(resolveDesktopDirection('/proj/specs/abc/review', '/proj/specs/abc')).toBe('back')
  })

  it('treats project switching as lateral', () => {
    expect(resolveDesktopDirection('/projA', '/projB')).toBe('lateral')
  })

  it('ignores search and hash when comparing depth', () => {
    expect(resolveDesktopDirection('/proj', '/proj/specs/abc?tab=1#top')).toBe('forward')
  })

  it('maps history traversal by sign, and skips a zero delta', () => {
    expect(resolveDesktopDirection('/proj/specs/abc', -1)).toBe('back')
    expect(resolveDesktopDirection('/proj', 2)).toBe('forward')
    expect(resolveDesktopDirection('/proj', 0)).toBeNull()
  })
})

describe('decideDirection', () => {
  const base = { fromPathname: '/proj', to: '/proj/specs/abc' }

  it('returns the resolved direction when nothing blocks it', () => {
    expect(decideDirection(base, resolveDesktopDirection)).toBe('forward')
  })

  it('skips replace navigations (same-page URL backfill, first-paint redirect)', () => {
    expect(decideDirection({ ...base, replace: true }, resolveDesktopDirection)).toBeNull()
  })

  it('skips when another listener already blocked the navigation', () => {
    expect(decideDirection({ ...base, defaultPrevented: true }, resolveDesktopDirection)).toBeNull()
  })

  it('skips when disabled (unsupported browser / reduced motion)', () => {
    expect(decideDirection({ ...base, enabled: false }, resolveDesktopDirection)).toBeNull()
  })

  it('skips search-only changes on the same pathname', () => {
    expect(
      decideDirection({ fromPathname: '/proj', to: '/proj?page=2' }, resolveDesktopDirection),
    ).toBeNull()
  })

  it('honours a resolver that opts out', () => {
    expect(decideDirection(base, () => null)).toBeNull()
  })
})
