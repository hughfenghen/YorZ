import type { Component } from 'solid-js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { useFocusModePage } from '../lib/layout-focus.js'
import { Breadcrumb } from '../components/Breadcrumb.jsx'
import { FocusModeButton } from '../components/FocusModeButton.jsx'
import { GitPanel } from '../components/GitPanel.jsx'
import { t } from '../i18n/index.js'

/**
 * Standalone git working-tree page: same panel as the spec Review page, minus
 * the spec context (no Agent dispatch, no prefilled commit message).
 */
export const GitStatus: Component = () => {
  const projectId = useCurrentProjectId()
  useFocusModePage()

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <header class="flex items-start justify-between gap-2">
        <Breadcrumb
          items={[
            { label: t('breadcrumb.specList'), href: projectHref('') },
            { label: t('git.title') },
          ]}
        />
        <div class="flex shrink-0 items-center gap-2 text-muted-foreground">
          <FocusModeButton />
        </div>
      </header>

      <GitPanel projectId={projectId} />
    </section>
  )
}
