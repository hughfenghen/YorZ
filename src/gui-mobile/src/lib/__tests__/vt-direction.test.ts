import { describe, expect, it } from 'vitest'
import { resolveMobileDirection } from '../vt-direction.js'

describe('resolveMobileDirection', () => {
  it('treats the four tab routes as lateral, base prefix included', () => {
    // `/`（深度 0）→ `/specs`（深度 1）按深度是下钻，但底部导航之间是平级
    expect(resolveMobileDirection('/m', '/m/specs')).toBe('lateral')
    expect(resolveMobileDirection('/m/specs', '/m/ext')).toBe('lateral')
    expect(resolveMobileDirection('/m/projects', '/m/')).toBe('lateral')
  })

  it('treats drilling into secondary / tertiary pages as forward', () => {
    expect(resolveMobileDirection('/m/specs', '/m/specs/abc')).toBe('forward')
    expect(resolveMobileDirection('/m/specs/abc', '/m/specs/abc/git')).toBe('forward')
    expect(resolveMobileDirection('/m/ext', '/m/ext/runs/r1')).toBe('forward')
    expect(resolveMobileDirection('/m/projects', '/m/settings/global')).toBe('forward')
  })

  it('treats the explicit back targets as back', () => {
    // 返回键都是 navigate('/显式目标')，history 里是 push，只能靠深度推
    expect(resolveMobileDirection('/m/specs/abc', '/m/specs')).toBe('back')
    expect(resolveMobileDirection('/m/specs/abc/git', '/m/specs/abc')).toBe('back')
    expect(resolveMobileDirection('/m/sessions/s1', '/m/')).toBe('back')
    expect(resolveMobileDirection('/m/settings/global', '/m/projects')).toBe('back')
    expect(resolveMobileDirection('/m/ext/runs/r1', '/m/ext')).toBe('back')
  })

  it('treats same-depth cross-module jumps as lateral', () => {
    expect(resolveMobileDirection('/m/sessions/s1', '/m/specs/abc')).toBe('lateral')
  })

  it('ignores search and hash, and maps history traversal by sign', () => {
    expect(resolveMobileDirection('/m/specs', '/m/specs/abc?from=list')).toBe('forward')
    expect(resolveMobileDirection('/m/specs/abc', -1)).toBe('back')
    expect(resolveMobileDirection('/m/specs', 1)).toBe('forward')
    expect(resolveMobileDirection('/m/specs', 0)).toBeNull()
  })
})
