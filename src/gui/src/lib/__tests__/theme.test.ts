import { describe, expect, it } from 'vitest'
import {
  isThemeMode,
  isThemeName,
  resolveTheme,
  THEME_NAME_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '../theme.js'

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

  it('拒绝非法值，保证损坏的 localStorage 能回落到 system', () => {
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

  it('拒绝非法值，保证损坏的 localStorage 能回落到 terminal', () => {
    expect(isThemeName('Terminal')).toBe(false)
    expect(isThemeName('dark')).toBe(false)
    expect(isThemeName('')).toBe(false)
    expect(isThemeName(null)).toBe(false)
    expect(isThemeName(undefined)).toBe(false)
  })
})

describe('THEME_STORAGE_KEY', () => {
  it('与 index.html 引导脚本内联的 key 保持一致', () => {
    // 引导脚本无法 import 本模块（必须同步内联），两处 key 只能靠此断言绑定
    expect(THEME_STORAGE_KEY).toBe('yorz.theme')
    expect(THEME_NAME_STORAGE_KEY).toBe('yorz.themeName')
  })
})
