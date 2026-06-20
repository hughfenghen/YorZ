import { A, useLocation } from '@solidjs/router'
import { onMount, Show, type JSX, type ParentComponent } from 'solid-js'
import { AgentPanelDock } from './components/AgentPanelDock.jsx'
import { agentTasks } from './lib/agent-tasks.js'

export const AppShell: ParentComponent = (props): JSX.Element => {
  const location = useLocation()
  const onNewSpecPage = () => location.pathname === '/specs/new'

  onMount(() => {
    void agentTasks.hydrateFromActiveRuns()
  })

  return (
    <div class="app">
      <header class="topbar">
        <A href="/" class="brand">
          YorZ
        </A>
        <Show
          when={onNewSpecPage()}
          fallback={
            <A href="/specs/new" class="primary-action">
              ＋ 新建 spec
            </A>
          }
        >
          <a
            href="/specs/new"
            class="primary-action"
            target="_blank"
            rel="noopener noreferrer"
          >
            ＋ 新建 spec
          </a>
        </Show>
      </header>
      <main class="content">{props.children}</main>
      <AgentPanelDock />
    </div>
  )
}
