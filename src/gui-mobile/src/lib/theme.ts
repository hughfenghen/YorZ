import { createSignal } from 'solid-js'

/**
 * 移动端外观状态。与桌面端 src/gui/src/lib/theme.ts 是**同源不同实例**：
 * 两端跑在同一个 origin 下，共用 localStorage 的 yorz.appearanceHint，
 * 于是在手机上切了主题、回到桌面端页面刷新也能对上。
 *
 * 之所以没有直接 import 桌面端那份：两个前端是各自独立的 TS 工程
 * （tsconfig.gui.json / tsconfig.gui-mobile.json，composite 要求文件归属唯一），
 * 跨工程直引源码会破坏增量构建。真正需要共享逻辑时（例如后续的 API 客户端），
 * 正确做法是抽到独立模块并让两个工程都 include，而不是从这里横向引用。
 *
 * 配色变量本身没有重复：两端共用 src/styles/theme-tokens.css。
 */

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemeName = 'terminal' | 'graphite' | 'paper'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']
export const THEME_NAMES: ThemeName[] = ['terminal', 'graphite', 'paper']

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * 首屏提示键。index.html 里的同步引导脚本读的就是它——那段脚本无法 import 本模块，
 * 所以键名与校验逻辑在两处各有一份，修改必须同步（桌面端同名文件亦然）。
 */
export const APPEARANCE_HINT_KEY = 'yorz.appearanceHint'

export interface AppearanceHint {
  mode: ThemeMode
  name: ThemeName
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode)
}

export function isThemeName(value: unknown): value is ThemeName {
  return THEME_NAMES.includes(value as ThemeName)
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
    // 隐私模式下 localStorage 可能不可用；读不到只会退回默认外观。
    return null
  }
}

export function writeAppearanceHint(mode: ThemeMode, name: ThemeName): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(APPEARANCE_HINT_KEY, JSON.stringify({ mode, name }))
  } catch {
    // 同上：写不进去只影响下次首屏，不影响本次会话。
  }
}

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** 把 mode 解析为实际生效的亮/暗。独立导出便于单测覆盖三态分支。 */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode
  return prefersDark ? 'dark' : 'light'
}

// 用首屏提示播种初值，否则 initTheme() 会把引导脚本刚写对的属性改回默认值。
const initialHint = readAppearanceHint()

const [themeMode, setThemeModeSignal] = createSignal<ThemeMode>(initialHint?.mode ?? 'system')
const [themeName, setThemeNameSignal] = createSignal<ThemeName>(initialHint?.name ?? 'paper')
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

function sync(mode: ThemeMode, name: ThemeName): void {
  const theme = resolveTheme(mode, systemTheme() === 'dark')
  setResolvedTheme(theme)
  applyToDocument(theme, name)
  writeAppearanceHint(mode, name)
}

export function setThemeMode(mode: ThemeMode): void {
  setThemeModeSignal(mode)
  sync(mode, themeName())
}

export function setThemeName(name: ThemeName): void {
  setThemeNameSignal(name)
  sync(themeMode(), name)
}

let initialized = false

/** 在应用入口尽早调用一次；重复调用安全。 */
export function initTheme(): void {
  if (initialized) return
  initialized = true
  sync(themeMode(), themeName())
  if (typeof window === 'undefined' || !window.matchMedia) return
  // 仅 system 模式需要跟随系统翻转；显式选了 light/dark 就忽略系统变化
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (themeMode() === 'system') sync('system', themeName())
  })
}
