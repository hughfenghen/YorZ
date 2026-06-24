import { Show, createResource, type Component } from 'solid-js'
import { Navigate } from '@solidjs/router'
import { api } from '../lib/api.js'
import { WelcomePage } from './Welcome.jsx'

export const ProjectIndexRedirect: Component = () => {
  const [projects] = createResource(() => api.listProjects())
  return (
    <Show when={!projects.loading} fallback={<p class="muted">加载中…</p>}>
      <Show when={(projects() ?? []).length > 0} fallback={<WelcomePage />}>
        {(() => {
          const list = projects() ?? []
          const first = list[0]
          if (!first) return null
          return <Navigate href={`/${encodeURIComponent(first.id)}`} />
        })()}
      </Show>
    </Show>
  )
}
