import { A, useLocation } from '@solidjs/router'
import { createEffect, type JSX, type ParentComponent } from 'solid-js'
import { Languages, Check } from 'lucide-solid'
import { AgentPanelDock } from './components/AgentPanelDock.jsx'
import { ProjectsSidebar } from './components/ProjectsSidebar.jsx'
import { Button } from './components/ui/button.jsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './components/ui/dropdown-menu.jsx'
import { Toaster } from './components/ui/sonner.jsx'
import { agentTasks } from './lib/agent-tasks.js'
import { activeProjectId, setActiveProjectId } from './lib/project.js'
import { t, useTranslation } from './i18n/index.js'

export const AppShell: ParentComponent = (props): JSX.Element => {
  const location = useLocation()
  const { lng, changeLanguage } = useTranslation()

  function selectLanguage(l: string): void {
    if (l === lng()) return
    void changeLanguage(l)
    window.location.reload()
  }

  createEffect(() => {
    const m = location.pathname.match(/^\/([^/]+)/)
    setActiveProjectId(m && m[1] !== 'api' ? m[1]! : '')
  })

  const hydratedFor = new Set<string>()
  createEffect(() => {
    const pid = activeProjectId()
    if (!pid || hydratedFor.has(pid)) return
    hydratedFor.add(pid)
    void agentTasks.hydrateFromActiveRuns(pid)
  })

  return (
    <div class="flex h-full flex-col">
      <header class="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-4">
        <A href="/" class="text-lg font-bold">
          YorZ
        </A>
        <div class="ml-auto">
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger
              as={Button}
              variant="ghost"
              size="icon"
              title={t('shell.languageSwitch')}
            >
              <Languages class="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => selectLanguage('zh-CN')}>
                <Check
                  class={`mr-2 h-4 w-4 ${lng() === 'zh-CN' ? 'opacity-100' : 'opacity-0'}`}
                />
                {t('shell.langZh')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => selectLanguage('en')}>
                <Check
                  class={`mr-2 h-4 w-4 ${lng() === 'en' ? 'opacity-100' : 'opacity-0'}`}
                />
                {t('shell.langEn')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div class="flex min-h-0 flex-1">
        <ProjectsSidebar />
        <main class="min-w-0 flex-1 overflow-auto">{props.children}</main>
      </div>
      <AgentPanelDock />
      <Toaster position="top-center" />
    </div>
  )
}
