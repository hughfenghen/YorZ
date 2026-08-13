import { createSignal } from 'solid-js'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemeName = 'terminal' | 'graphite' | 'paper'
export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isThemeName(value: unknown): value is ThemeName {
  return value === 'terminal' || value === 'graphite' || value === 'paper'
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

const [themeMode, setThemeModeSignal] = createSignal<ThemeMode>('system')
const [themeName, setThemeNameSignal] = createSignal<ThemeName>('terminal')
const [resolvedTheme, setResolvedTheme] = createSignal<ResolvedTheme>(
  resolveTheme('system', systemTheme() === 'dark'),
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
  sync(mode)
}

export function setThemeName(name: ThemeName): void {
  setThemeNameSignal(name)
  applyToDocument(resolvedTheme(), name)
}

export function applyAppearance(mode: ThemeMode, name: ThemeName): void {
  setThemeNameSignal(name)
  setThemeMode(mode)
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
