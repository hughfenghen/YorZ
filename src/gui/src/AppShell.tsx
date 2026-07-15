import { A, useLocation } from '@solidjs/router'
import { Show, createEffect, createMemo, type JSX, type ParentComponent } from 'solid-js'
import { Languages, Check, Plus } from 'lucide-solid'
import { ProjectsSidebar } from './components/ProjectsSidebar.jsx'
import { ChatPanel } from './components/ChatPanel.jsx'
import { Button } from './components/ui/button.jsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './components/ui/dropdown-menu.jsx'
import { Toaster } from './components/ui/sonner.jsx'
import { activeProjectId, projectHref, setActiveProjectId } from './lib/project.js'
import { t, useTranslation } from './i18n/index.js'

export const AppShell: ParentComponent = (props): JSX.Element => {
  const location = useLocation()
  const { lng, changeLanguage } = useTranslation()

  // Already on the New Spec page? A same-route navigation would be a no-op, so
  // open a fresh tab instead — that's the only way "new spec" does something here.
  const onNewSpecPage = createMemo(() => location.pathname === projectHref('specs/new'))

  function selectLanguage(l: string): void {
    if (l === lng()) return
    void changeLanguage(l)
    window.location.reload()
  }

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
              title={t('shell.languageSwitch')}
            >
              <Languages class="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => selectLanguage('zh-CN')}>
                <Check class={`mr-2 h-4 w-4 ${lng() === 'zh-CN' ? 'opacity-100' : 'opacity-0'}`} />
                {t('shell.langZh')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => selectLanguage('en')}>
                <Check class={`mr-2 h-4 w-4 ${lng() === 'en' ? 'opacity-100' : 'opacity-0'}`} />
                {t('shell.langEn')}
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
    </div>
  )
}
