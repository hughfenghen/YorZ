import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { api } from '@shared/api/index.js'
import { renderMarkdown, stripFrontmatter } from '@shared/lib/markdown.js'
import { renderMermaidCore } from '@shared/lib/mermaid-core.js'
import { Page } from '@/components/Page.jsx'
import { ErrorNotice, LoadingNotice, NoProjectNotice, Notice } from '@/components/ListStates.jsx'
import { MermaidViewer } from '@/components/MermaidViewer.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { t } from '@/i18n/index.js'

/** 移动端 debug.md 阅读页；数据与渲染能力和 spec 正文共用同一套共享实现。 */
export const SpecDebug: Component = () => {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [articleEl, setArticleEl] = createSignal<HTMLElement | null>(null)
  const [diagram, setDiagram] = createSignal<string | null>(null)

  const [spec] = createResource(
    () => {
      const pid = activeProjectId()
      return pid ? ([pid, params.id] as const) : null
    },
    ([pid, id]) => api.getSpec(pid, id),
  )
  const [debug, { refetch }] = createResource(
    () => {
      const pid = activeProjectId()
      return pid ? ([pid, params.id] as const) : null
    },
    ([pid, id]) => api.getDebug(pid, id),
  )

  const debugHtml = createMemo(() => {
    const text = stripFrontmatter(debug()?.text ?? '')
    if (!text.trim()) return ''
    return renderMarkdown(text, { specId: params.id, projectId: activeProjectId() || undefined })
  })

  createEffect(() => {
    const el = articleEl()
    const html = debugHtml()
    if (!el) return
    el.innerHTML = html

    let active = true
    let cleanupFn: (() => void) | undefined
    void renderMermaidCore(el).then((cleanup) => {
      if (!active) {
        cleanup()
        return
      }
      cleanupFn = cleanup
    })

    onCleanup(() => {
      active = false
      cleanupFn?.()
    })
  })

  function onArticleClick(e: MouseEvent) {
    if (!(e.target instanceof Element)) return
    const svg = e.target.closest('.mermaid')?.querySelector('svg')
    if (svg) setDiagram(svg.outerHTML)
  }

  return (
    <Page
      title={t('specDetail.debug')}
      padded={false}
      onBack={() => navigate(`/specs/${encodeURIComponent(params.id)}`)}
    >
      <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
        <Show when={spec()?.frontmatter.summary}>
          {(summary) => (
            <p class="border-b border-border px-4 py-3 text-sm leading-relaxed">{summary()}</p>
          )}
        </Show>
        <Show when={!debug.loading} fallback={<LoadingNotice />}>
          <Show
            when={!debug.error}
            fallback={<ErrorNotice error={debug.error} onRetry={() => void refetch()} />}
          >
            <Show when={debugHtml()} fallback={<Notice title={t('specDebug.empty')} />}>
              <article ref={setArticleEl} class="markdown px-4 py-4" onClick={onArticleClick} />
            </Show>
          </Show>
        </Show>
      </Show>

      <MermaidViewer svg={diagram()} onClose={() => setDiagram(null)} />
    </Page>
  )
}
