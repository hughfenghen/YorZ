import { Show, createResource, type Component } from 'solid-js'
import { Navigate } from '@solidjs/router'
import { api } from '../lib/api.js'
import { WelcomePage } from './Welcome.jsx'
import { t } from '../i18n/index.js'

export const ProjectIndexRedirect: Component = () => {
  const [projects] = createResource(() => api.listProjects())
  return (
    <Show when={!projects.loading} fallback={<p class="p-8 text-muted-foreground">{t('common.loading')}</p>}>
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
