import { A } from '@solidjs/router'
import { onMount, type JSX, type ParentComponent } from 'solid-js'
import { AgentPanelDock } from './components/AgentPanelDock.jsx'
import { agentTasks } from './lib/agent-tasks.js'

export const AppShell: ParentComponent = (props): JSX.Element => {
  onMount(() => {
    void agentTasks.hydrateFromActiveRuns()
  })

  return (
    <div class="app">
      <header class="topbar">
        <A href="/" class="brand">
          YorZ
        </A>
        <A href="/specs/new" class="primary-action">
          ＋ 新建 spec
        </A>
      </header>
      <main class="content">{props.children}</main>
      <AgentPanelDock />
    </div>
  )
}
