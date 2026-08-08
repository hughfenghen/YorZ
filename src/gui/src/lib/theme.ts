import { createSignal } from 'solid-js'

/**
 * 主题状态：唯一真相源。
 *
 * 为什么不落 global-config：全局配置需异步 GET，会在首屏造成主题闪烁；主题是端侧偏好
 * 而非项目配置。与 i18n 的 'yorz.lang' 保持同一套 localStorage 心智。
 *
 * 引导阶段由 index.html 的同步内联脚本先写好 <html data-kb-theme>，此模块加载后接管。
 */

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemeName = 'terminal' | 'graphite' | 'paper'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'yorz.theme'
export const THEME_NAME_STORAGE_KEY = 'yorz.themeName'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isThemeName(value: unknown): value is ThemeName {
  return value === 'terminal' || value === 'graphite' || value === 'paper'
}

function readStoredMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system'
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

function readStoredName(): ThemeName {
  if (typeof localStorage === 'undefined') return 'terminal'
  try {
    const raw = localStorage.getItem(THEME_NAME_STORAGE_KEY)
    return isThemeName(raw) ? raw : 'terminal'
  } catch {
    return 'terminal'
  }
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** 把 mode 解析为实际生效的亮/暗。导出供单测直接覆盖三态分支。 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode
  return prefersDark ? 'dark' : 'light'
}

const [themeMode, setThemeModeSignal] = createSignal<ThemeMode>(readStoredMode())
const [themeName, setThemeNameSignal] = createSignal<ThemeName>(readStoredName())
const [resolvedTheme, setResolvedTheme] = createSignal<ResolvedTheme>(
  resolveTheme(readStoredMode(), systemTheme() === 'dark'),
)

export { themeMode, themeName, resolvedTheme }

function applyToDocument(theme: ResolvedTheme, name: ThemeName): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-kb-theme', theme)
  document.documentElement.setAttribute('data-kb-theme-name', name)
  // 让原生控件（滚动条、表单部件）跟随主题
  document.documentElement.style.colorScheme = theme
}

function sync(mode: ThemeMode): void {
  const theme = resolveTheme(mode, systemTheme() === 'dark')
  setResolvedTheme(theme)
  applyToDocument(theme, themeName())
}

export function setThemeMode(mode: ThemeMode): void {
  setThemeModeSignal(mode)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // 隐私模式下写入失败不应影响当前会话内的主题切换
  }
  sync(mode)
}

export function setThemeName(name: ThemeName): void {
  setThemeNameSignal(name)
  try {
    localStorage.setItem(THEME_NAME_STORAGE_KEY, name)
  } catch {
    // 隐私模式下写入失败不应影响当前会话内的主题切换
  }
  applyToDocument(resolvedTheme(), name)
}

let initialized = false

/** 在应用入口尽早调用一次；重复调用是安全的。 */
export function initTheme(): void {
  if (initialized) return
  initialized = true
  sync(themeMode())
  if (typeof window === 'undefined' || !window.matchMedia) return
  // 仅 system 模式需要跟随系统翻转；显式选择 light/dark 时忽略系统变化
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (themeMode() === 'system') sync('system')
  })
}
