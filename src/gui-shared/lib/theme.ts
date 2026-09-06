import { createSignal } from 'solid-js'

/**
 * 两端共用的外观状态（桌面端 src/gui + 移动端 src/gui-mobile）。
 *
 * 两端跑在同一个 origin 下，共用 localStorage 的 `yorz.appearanceHint`，
 * 于是在手机上切了主题、回到桌面端页面刷新也能对上。
 *
 * 唯一的平台差异是 **hint 写入策略**，由 `initTheme({ persistHint })` 参数化：
 *   - 桌面端 `persistHint: false` —— 外观真值在服务端 `config.json`，
 *     hint 由 `src/gui/src/lib/global-config.ts` 的 `applyGlobalAppearance` 写；
 *   - 移动端 `persistHint: true` —— 没有服务端真值这一层，自己写 localStorage。
 *
 * 配色变量本身不在这里：两端共用 src/styles/theme-tokens.css。
 */

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemeName = 'terminal' | 'graphite' | 'paper'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']
export const THEME_NAMES: ThemeName[] = ['terminal', 'graphite', 'paper']

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * 外观偏好的本地镜像键，作为**首屏提示**供两端 index.html 的同步引导脚本读取。
 *
 * 注意：`src/gui/index.html` 与 `src/gui-mobile/index.html` 都无法 import 本模块，
 * 键名与校验逻辑在三处各有一份，修改时必须同步。旧键 `yorz.theme` /
 * `yorz.themeName` 是待迁移的历史数据，会被 `clearLegacyAppearanceStorage()`
 * 清除，故另起新键。
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

/** 由 initTheme(options) 设定；默认 false，与桌面端历史行为一致。 */
let persistHint = false

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
  if (persistHint) writeAppearanceHint(mode, name)
}

export function setThemeMode(mode: ThemeMode): void {
  setThemeModeSignal(mode)
  sync(mode, themeName())
}

export function setThemeName(name: ThemeName): void {
  setThemeNameSignal(name)
  sync(themeMode(), name)
}

/** 一次性套用整组外观（桌面端由服务端配置回灌时使用）。 */
export function applyAppearance(mode: ThemeMode, name: ThemeName): void {
  setThemeNameSignal(name)
  setThemeMode(mode)
}

export interface InitThemeOptions {
  /**
   * 是否由本模块负责把生效外观写入 localStorage 首屏提示。
   * 桌面端传 false（真值在服务端，hint 由 global-config 写），移动端传 true。
   */
  persistHint?: boolean
}

let initialized = false

/** 在应用入口尽早调用一次；重复调用安全。 */
export function initTheme(options: InitThemeOptions = {}): void {
  if (initialized) return
  initialized = true
  persistHint = options.persistHint ?? false
  sync(themeMode(), themeName())
  if (typeof window === 'undefined' || !window.matchMedia) return
  // 仅 system 模式需要跟随系统翻转；显式选了 light/dark 就忽略系统变化
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (themeMode() === 'system') sync('system', themeName())
  })
}
