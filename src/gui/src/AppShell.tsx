import { A, useLocation } from '@solidjs/router'
import { createEffect, Show, type JSX, type ParentComponent } from 'solid-js'
import { AgentPanelDock } from './components/AgentPanelDock.jsx'
import { ProjectsSidebar } from './components/ProjectsSidebar.jsx'
import { agentTasks } from './lib/agent-tasks.js'
import { activeProjectId, projectHref, setActiveProjectId } from './lib/project.js'

export const AppShell: ParentComponent = (props): JSX.Element => {
  const location = useLocation()
  const onNewSpecPage = () => /\/specs\/new$/.test(location.pathname)
  const hasProject = () => activeProjectId() !== ''

  createEffect(() => {
    const m = location.pathname.match(/^\/([^/]+)/)
    setActiveProjectId(m && m[1] !== 'api' ? m[1]! : '')
  })

  const hydratedFor = new Set<string>()
  createEffect(() => {
    const pid = activeProjectId()
    if (!pid || hydratedFor.has(pid)) return
    hydratedFor.add(pid)
    void agentTasks.hydrateFromActiveRuns()
  })

  return (
    <div class="app">
      <header class="topbar">
        <A href="/" class="brand">
          YorZ
        </A>
        <Show when={hasProject()}>
          <Show
            when={onNewSpecPage()}
            fallback={
              <A href={projectHref('specs/new')} class="primary-action">
                ＋ 新建 spec
              </A>
            }
          >
            <a
              href={projectHref('specs/new')}
              class="primary-action"
              target="_blank"
              rel="noopener noreferrer"
            >
              ＋ 新建 spec
            </a>
          </Show>
        </Show>
      </header>
      <div class="shell-body">
        <ProjectsSidebar />
        <main class="content">{props.children}</main>
      </div>
      <AgentPanelDock />
    </div>
  )
}
