import { Suspense, createMemo, createResource, type Component } from 'solid-js'
import { useParams } from '@solidjs/router'
import { api } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { useFocusModePage } from '../lib/layout-focus.js'
import { Breadcrumb } from '../components/Breadcrumb.jsx'
import { FocusModeButton } from '../components/FocusModeButton.jsx'
import { GitPanel } from '../components/GitPanel.jsx'
import { t } from '../i18n/index.js'

/**
 * Spec-scoped git page. Everything interactive lives in `GitPanel`; this shell
 * only supplies the spec context — breadcrumb, summary line, and the commit
 * message prefilled from the spec's own summary.
 */
export const SpecReview: Component = () => {
  const params = useParams<{ id: string }>()
  const projectId = useCurrentProjectId()
  const [spec] = createResource(
    () => [projectId(), params.id] as const,
    ([pid, id]) => api.getSpec(pid, id),
  )
  useFocusModePage()

  const defaultCommitMessage = createMemo(() => {
    const parts = params.id.split('.')
    const type = parts.length >= 2 ? parts[1]! : 'feat'
    const summary = spec()?.frontmatter.summary ?? ''
    return summary ? `${type}: ${summary}` : `${type}: update`
  })

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <Suspense fallback={<p class="text-muted-foreground">{t('common.loading')}</p>}>
        <header class="flex items-start justify-between gap-2">
          <div class="flex flex-col gap-1">
            <Breadcrumb
              items={[
                { label: t('breadcrumb.specList'), href: projectHref('') },
                { label: params.id, href: projectHref(`specs/${params.id}`) },
                { label: t('git.title') },
              ]}
            />
            <p class=" text-muted-foreground">
              {spec()?.frontmatter.summary || t('common.pendingAgent')}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2 text-muted-foreground">
            <FocusModeButton />
          </div>
        </header>

        <GitPanel
          projectId={projectId}
          specId={() => params.id}
          initialMessage={defaultCommitMessage}
        />
      </Suspense>
    </section>
  )
}
