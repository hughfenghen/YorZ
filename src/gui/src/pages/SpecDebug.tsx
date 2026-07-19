import { Show, Suspense, createMemo, createResource, type Component } from 'solid-js'
import { useParams } from '@solidjs/router'
import { api } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { useFocusModePage } from '../lib/layout-focus.js'
import { renderMarkdown, stripFrontmatter } from '../lib/markdown.js'
import { Breadcrumb } from '../components/Breadcrumb.jsx'
import { FocusModeButton } from '../components/FocusModeButton.jsx'
import { t } from '../i18n/index.js'

export const SpecDebug: Component = () => {
  const params = useParams<{ id: string }>()
  const projectId = useCurrentProjectId()
  useFocusModePage()

  const [spec] = createResource(
    () => [projectId(), params.id] as const,
    ([pid, id]) => api.getSpec(pid, id),
  )
  const [debug] = createResource(
    () => [projectId(), params.id] as const,
    ([pid, id]) => api.getDebug(pid, id),
  )

  const debugHtml = createMemo(() => {
    const text = stripFrontmatter(debug()?.text ?? '')
    if (!text.trim()) return ''
    return renderMarkdown(text, { specId: params.id, projectId: projectId() })
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
                { label: t('specDetail.debug') },
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

        <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <Show
            when={debug.loading}
            fallback={
              <Show
                when={debugHtml()}
                fallback={
                  <div class="flex flex-1 items-center justify-center text-muted-foreground">
                    {t('specDebug.empty')}
                  </div>
                }
              >
                <article
                  class="markdown review-md flex-1 overflow-auto rounded-xl border bg-card p-4 shadow"
                  innerHTML={debugHtml()}
                />
              </Show>
            }
          >
            <p class="text-muted-foreground">{t('common.loading')}</p>
          </Show>
        </section>
      </Suspense>
    </section>
  )
}
