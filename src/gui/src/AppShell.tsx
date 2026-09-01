import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
  type ParentComponent,
} from 'solid-js'
import { A, useLocation, useNavigate } from '@solidjs/router'
import {
  Check,
  Languages,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  PanelLeft,
  Plus,
  Settings,
  Sun,
} from 'lucide-solid'
import { ProjectsSidebar } from './components/ProjectsSidebar.jsx'
import { ChatPanel } from './components/ChatPanel.jsx'
import { GlobalConfigDialog } from './components/GlobalConfigDialog.jsx'
import { SystemNotifications } from './components/SystemNotifications.jsx'
import { Button } from './components/ui/button.jsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './components/ui/dropdown-menu.jsx'
import { Toaster } from './components/ui/toast.jsx'
import { globalConfig, refreshGlobalConfig, updateGlobalConfig } from './lib/global-config.js'
import { activeProjectId, projectHref, setActiveProjectId } from './lib/project.js'
import { focusModeShortcutHandler, requestProjectConfigOpen } from './lib/shortcut-actions.js'
import {
  DEFAULT_SHORTCUTS,
  effectiveShortcuts,
  isEditableShortcutTarget,
  shortcutFromEvent,
} from './lib/shortcuts.js'
import {
  setThemeMode,
  setThemeName,
  themeMode,
  themeName,
  type ThemeMode,
  type ThemeName,
} from './lib/theme.js'
import { t, useTranslation } from './i18n/index.js'
import { createMediaQuery, MOBILE_MEDIA_QUERY } from './lib/media-query.js'
import { createVisualViewport, ensureFocusedVisible } from './lib/visual-viewport.js'

const THEME_OPTIONS: { mode: ThemeMode; labelKey: string; icon: typeof Sun }[] = [
  { mode: 'system', labelKey: 'shell.themeSystem', icon: Monitor },
  { mode: 'light', labelKey: 'shell.themeLight', icon: Sun },
  { mode: 'dark', labelKey: 'shell.themeDark', icon: Moon },
]

const THEME_NAME_OPTIONS: { name: ThemeName; labelKey: string }[] = [
  { name: 'terminal', labelKey: 'shell.themeTerminal' },
  { name: 'graphite', labelKey: 'shell.themeGraphite' },
  { name: 'paper', labelKey: 'shell.themePaper' },
]

export const AppShell: ParentComponent = (props): JSX.Element => {
  const location = useLocation()
  const navigate = useNavigate()
  const { lng, changeLanguage } = useTranslation()
  const [globalConfigOpen, setGlobalConfigOpen] = createSignal(false)

  // 移动端（< 768px）三栏横排会把 main 挤没：两侧栏改为 fixed 抽屉覆盖层，
  // 由顶栏按钮开关；桌面端渲染路径保持完全不变。
  const isMobile = createMediaQuery(MOBILE_MEDIA_QUERY)
  const [mobileDrawer, setMobileDrawer] = createSignal<'none' | 'projects' | 'chat'>('none')
  // 可视视口：软键盘弹出/收起、用户平移时更新；抽屉与聚焦滚入都按它钳制。
  const vv = createVisualViewport()

  // Already on the New Spec page? A same-route navigation would be a no-op, so
  // open a fresh tab instead — that's the only way "new spec" does something here.
  const onNewSpecPage = createMemo(() => location.pathname === projectHref('specs/new'))

  function selectLanguage(l: 'zh-CN' | 'en'): void {
    if (l === lng()) return
    void changeLanguage(l)
    void updateGlobalConfig((current) => ({
      ...current,
      appearance: { ...current.appearance, language: l },
    }))
  }

  function selectThemeMode(mode: ThemeMode): void {
    setThemeMode(mode)
    void updateGlobalConfig((current) => ({
      ...current,
      appearance: { ...current.appearance, themeMode: mode },
    }))
  }

  function selectThemeName(name: ThemeName): void {
    setThemeName(name)
    void updateGlobalConfig((current) => ({
      ...current,
      appearance: { ...current.appearance, themeName: name },
    }))
  }

  function openNewSpec(): void {
    if (!activeProjectId()) return
    const href = projectHref('specs/new')
    if (onNewSpecPage()) window.open(href, '_blank', 'noopener')
    else navigate(href)
  }

  function runShortcut(binding: string): boolean {
    const shortcuts = effectiveShortcuts(globalConfig().shortcuts)
    if (binding === shortcuts.newSpec) {
      openNewSpec()
      return true
    }
    if (binding === shortcuts.projectSettings) {
      requestProjectConfigOpen()
      return true
    }
    if (binding === shortcuts.toggleSpecDetailFullscreen) {
      const handler = focusModeShortcutHandler()
      if (!handler) return false
      handler()
      return true
    }
    return false
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const binding = shortcutFromEvent(event)
    if (!binding) return
    const shortcuts = effectiveShortcuts(globalConfig().shortcuts)
    // Toggles must stay reachable from inside a text field: focus mode is often
    // entered while typing, and the settings dialog autofocuses its own input —
    // if that swallowed the key, the shortcut could open the dialog but never
    // close it.
    const isToggleBinding =
      binding === shortcuts.toggleSpecDetailFullscreen || binding === shortcuts.projectSettings
    if (isEditableShortcutTarget(event.target) && !isToggleBinding) return
    if (
      binding !== DEFAULT_SHORTCUTS.newSpec &&
      binding !== DEFAULT_SHORTCUTS.projectSettings &&
      binding !== DEFAULT_SHORTCUTS.toggleSpecDetailFullscreen &&
      !Object.values(globalConfig().shortcuts).includes(binding)
    ) {
      return
    }
    if (!runShortcut(binding)) return
    event.preventDefault()
  }

  onMount(() => {
    void refreshGlobalConfig()
    window.addEventListener('keydown', onKeyDown)
    // 移动端软键盘修复：聚焦输入（延迟等键盘动画）以及键盘弹起的 resize 时，
    // 把聚焦的流内输入滚回可视视口（fixed 浮层由组件自身按 vv 重定位）。
    const vvApi = window.visualViewport
    let focusTimer: number | undefined
    const revealFocused = (): void => {
      if (vv().keyboardOpen) ensureFocusedVisible()
    }
    const onFocusIn = (): void => {
      window.clearTimeout(focusTimer)
      focusTimer = window.setTimeout(revealFocused, 300)
    }
    document.addEventListener('focusin', onFocusIn)
    vvApi?.addEventListener('resize', revealFocused)
    onCleanup(() => {
      document.removeEventListener('focusin', onFocusIn)
      vvApi?.removeEventListener('resize', revealFocused)
      window.clearTimeout(focusTimer)
    })
  })
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  createEffect(() => {
    const m = location.pathname.match(/^\/([^/]+)/)
    setActiveProjectId(m && m[1] !== 'api' ? m[1]! : '')
  })

  // 移动端路由跳转后自动收起抽屉，避免遮挡新页面内容。
  createEffect(() => {
    void location.pathname
    if (isMobile()) setMobileDrawer('none')
  })

  return (
    <div class="flex h-full flex-col">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-4">
        <Show when={isMobile()}>
          <Button
            variant="ghost"
            size="icon"
            title={t('shell.openProjectsDrawer')}
            onClick={() => setMobileDrawer((d) => (d === 'projects' ? 'none' : 'projects'))}
          >
            <PanelLeft class="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t('shell.openChatDrawer')}
            onClick={() => setMobileDrawer((d) => (d === 'chat' ? 'none' : 'chat'))}
          >
            <MessageSquare class="h-5 w-5" />
          </Button>
        </Show>
        <A href="/" class="text-lg font-bold">
          YorZ
        </A>
        <SystemNotifications />
        <div class="ml-auto flex items-center gap-2">
          <Show when={activeProjectId()}>
            <Button
              as={A}
              href={projectHref('specs/new')}
              target={onNewSpecPage() ? '_blank' : undefined}
              rel={onNewSpecPage() ? 'noopener' : undefined}
              variant="default"
              size="sm"
            >
              <Plus class="mr-1 h-4 w-4" />
              {t('shell.newSpec')}
            </Button>
          </Show>
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger
              as={Button}
              variant="ghost"
              size="icon"
              title={t('shell.settingsMenu')}
            >
              <Menu class="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {/* 语言与外观都是低频偏好，收进二级菜单，一级只留高频的全局配置 */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-submenu="language">
                  <Languages class="mr-2 h-4 w-4" />
                  {t('shell.languageSwitch')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => selectLanguage('zh-CN')}>
                    <Check
                      class={`mr-2 h-4 w-4 ${lng() === 'zh-CN' ? 'opacity-100' : 'opacity-0'}`}
                    />
                    {t('shell.langZh')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => selectLanguage('en')}>
                    <Check class={`mr-2 h-4 w-4 ${lng() === 'en' ? 'opacity-100' : 'opacity-0'}`} />
                    {t('shell.langEn')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-submenu="theme">
                  <Palette class="mr-2 h-4 w-4" />
                  {t('shell.themeSwitch')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <div class="px-2 py-1 text-xs text-muted-foreground">
                    {t('shell.themeModeGroup')}
                  </div>
                  <For each={THEME_OPTIONS}>
                    {(option) => (
                      <DropdownMenuItem
                        data-theme-option={option.mode}
                        onSelect={() => selectThemeMode(option.mode)}
                      >
                        <Check
                          class={`mr-2 h-4 w-4 ${themeMode() === option.mode ? 'opacity-100' : 'opacity-0'}`}
                        />
                        <option.icon class="mr-2 h-4 w-4 text-muted-foreground" />
                        {t(option.labelKey)}
                      </DropdownMenuItem>
                    )}
                  </For>
                  <DropdownMenuSeparator />
                  <div class="px-2 py-1 text-xs text-muted-foreground">
                    {t('shell.themeNameGroup')}
                  </div>
                  <For each={THEME_NAME_OPTIONS}>
                    {(option) => (
                      <DropdownMenuItem
                        data-theme-name-option={option.name}
                        onSelect={() => selectThemeName(option.name)}
                      >
                        <Check
                          class={`mr-2 h-4 w-4 ${themeName() === option.name ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {t(option.labelKey)}
                      </DropdownMenuItem>
                    )}
                  </For>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setGlobalConfigOpen(true)}>
                <Settings class="mr-2 h-4 w-4" />
                {t('shell.globalConfig')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div class="flex min-h-0 flex-1">
        <Show when={!isMobile()}>
          <ProjectsSidebar />
          <ChatPanel />
        </Show>
        <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">{props.children}</main>
      </div>
      {/* 移动端抽屉：覆盖层 + 半透明 backdrop，点击 backdrop 关闭 */}
      <Show when={isMobile() && mobileDrawer() !== 'none'}>
        <div
          class="fixed inset-0 z-40 bg-black/50"
          aria-hidden="true"
          onClick={() => setMobileDrawer('none')}
        />
        <div
          class="fixed left-0 z-50 flex max-w-[85vw] shadow-xl"
          style={{ top: `${vv().offsetTop}px`, height: `${vv().height}px` }}
        >
          <Show when={mobileDrawer() === 'projects'} fallback={<ChatPanel />}>
            <ProjectsSidebar />
          </Show>
        </div>
      </Show>
      <Toaster position="top-center" />
      <GlobalConfigDialog open={globalConfigOpen()} onClose={() => setGlobalConfigOpen(false)} />
    </div>
  )
}
