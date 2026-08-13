import { describe, expect, it } from 'vitest'
import { isThemeMode, isThemeName, resolveTheme } from '../theme.js'

describe('resolveTheme', () => {
  it('显式 light/dark 覆盖系统偏好', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('dark', true)).toBe('dark')
  })

  it('system 模式跟随系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('isThemeMode', () => {
  it('接受三种合法模式', () => {
    expect(isThemeMode('system')).toBe(true)
    expect(isThemeMode('light')).toBe(true)
    expect(isThemeMode('dark')).toBe(true)
  })

  it('拒绝非法值', () => {
    expect(isThemeMode('DARK')).toBe(false)
    expect(isThemeMode('')).toBe(false)
    expect(isThemeMode(null)).toBe(false)
    expect(isThemeMode(undefined)).toBe(false)
    expect(isThemeMode(0)).toBe(false)
  })
})

describe('isThemeName', () => {
  it('接受三种合法主题族', () => {
    expect(isThemeName('terminal')).toBe(true)
    expect(isThemeName('graphite')).toBe(true)
    expect(isThemeName('paper')).toBe(true)
  })

  it('拒绝非法值', () => {
    expect(isThemeName('Terminal')).toBe(false)
    expect(isThemeName('dark')).toBe(false)
    expect(isThemeName('')).toBe(false)
    expect(isThemeName(null)).toBe(false)
    expect(isThemeName(undefined)).toBe(false)
  })
})
