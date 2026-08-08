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
import { Check, Languages, Menu, Monitor, Moon, Palette, Plus, Settings, Sun } from 'lucide-solid'
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
import { toast, Toaster } from './components/ui/toast.jsx'
import { api, type GlobalConfig } from './lib/api.js'
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

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  agent: {
    defaultKind: 'claude',
  },
  notifications: {
    sessionEnd: {
      banner: false,
      sound: false,
    },
  },
  shortcuts: {},
  power: {
    inhibitWhenRunning: 'system-default',
  },
}

export const AppShell: ParentComponent = (props): JSX.Element => {
  const location = useLocation()
  const navigate = useNavigate()
  const { lng, changeLanguage } = useTranslation()
  const [globalConfigOpen, setGlobalConfigOpen] = createSignal(false)
  const [globalConfig, setGlobalConfig] = createSignal<GlobalConfig>(DEFAULT_GLOBAL_CONFIG)

  // Already on the New Spec page? A same-route navigation would be a no-op, so
  // open a fresh tab instead — that's the only way "new spec" does something here.
  const onNewSpecPage = createMemo(() => location.pathname === projectHref('specs/new'))

  function selectLanguage(l: string): void {
    if (l === lng()) return
    void changeLanguage(l)
    window.location.reload()
  }

  async function refreshGlobalConfig(): Promise<void> {
    try {
      setGlobalConfig(await api.getGlobalConfig())
    } catch {
      setGlobalConfig(DEFAULT_GLOBAL_CONFIG)
    }
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
    const isFocusModeBinding = binding === shortcuts.toggleSpecDetailFullscreen
    if (isEditableShortcutTarget(event.target) && !isFocusModeBinding) return
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
  })
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  createEffect(() => {
    const m = location.pathname.match(/^\/([^/]+)/)
    setActiveProjectId(m && m[1] !== 'api' ? m[1]! : '')
  })

  return (
    <div class="flex h-full flex-col">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-4">
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
                        onSelect={() => setThemeMode(option.mode)}
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
                        onSelect={() => setThemeName(option.name)}
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
        <ProjectsSidebar />
        <ChatPanel />
        <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">{props.children}</main>
      </div>
      <Toaster position="top-center" />
      <GlobalConfigDialog
        open={globalConfigOpen()}
        onClose={() => setGlobalConfigOpen(false)}
        onSaved={(message) => {
          toast.success(message)
          void refreshGlobalConfig()
        }}
      />
    </div>
  )
}
