import { createSignal } from 'solid-js'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemeName = 'terminal' | 'graphite' | 'paper'
export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * 外观偏好的本地镜像键。真值仍在服务端 `config.json`，但那需要一次异步 GET，
 * 首屏在响应到达前只能按默认 terminal 亮色绘制，造成刷新闪烁。
 * 这里把最近一次生效的外观同步写入 localStorage 作为**首屏提示**，
 * 供 `src/gui/index.html` 的同步引导脚本读取。
 *
 * 注意：`src/gui/index.html` 无法 import 本模块，键名与校验逻辑在两处各有一份，
 * 修改时必须同步。旧键 `yorz.theme` / `yorz.themeName` 是待迁移的历史数据，
 * 会被 `clearLegacyAppearanceStorage()` 清除，故另起新键。
 */
export const APPEARANCE_HINT_KEY = 'yorz.appearanceHint'

export interface AppearanceHint {
  mode: ThemeMode
  name: ThemeName
}

export function readAppearanceHint(): AppearanceHint | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(APPEARANCE_HINT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const { mode, name } = parsed as Record<string, unknown>
    if (!isThemeMode(mode) || !isThemeName(name)) return null
    return { mode, name }
  } catch {
    // localStorage 在隐私模式下可能不可用；提示缺失只会退回默认首屏。
    return null
  }
}

export function writeAppearanceHint(mode: ThemeMode, name: ThemeName): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(APPEARANCE_HINT_KEY, JSON.stringify({ mode, name }))
  } catch {
    // 同上：写不进去只影响首屏提示，不影响真值。
  }
}

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

// 用首屏提示播种初值：否则 initTheme() 的 sync() 会拿默认 system/terminal
// 把引导脚本刚写对的属性又改回去，等于白做一次首屏引导。
const initialHint = readAppearanceHint()

const [themeMode, setThemeModeSignal] = createSignal<ThemeMode>(initialHint?.mode ?? 'system')
const [themeName, setThemeNameSignal] = createSignal<ThemeName>(initialHint?.name ?? 'terminal')
const [resolvedTheme, setResolvedTheme] = createSignal<ResolvedTheme>(
  resolveTheme(initialHint?.mode ?? 'system', systemTheme() === 'dark'),
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
