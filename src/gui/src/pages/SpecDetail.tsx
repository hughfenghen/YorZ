import {
  Show,
  Suspense,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { useParams, useSearchParams } from '@solidjs/router'
import { api } from '../lib/api.js'
import { renderMarkdown } from '../lib/markdown.js'
import { subscribeSpec } from '../lib/sse.js'
import { agentTasks } from '../lib/agent-tasks.js'
import { observeSelection, type SelectionSnapshot } from '../lib/selection.js'
import { SelectionMenu } from '../components/SelectionMenu.jsx'
import { AnnotatePopover } from '../components/AnnotatePopover.jsx'

export const SpecDetail: Component = () => {
  const params = useParams<{ id: string }>()
  const [search, setSearch] = useSearchParams<{ runId?: string }>()
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [spec] = createResource(
    () => [params.id, refreshTick()] as const,
    async ([id]) => api.getSpec(id),
  )

  const [snap, setSnap] = createSignal<SelectionSnapshot | null>(null)
  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const [popoverSnap, setPopoverSnap] = createSignal<SelectionSnapshot | null>(null)
  const [runError, setRunError] = createSignal<string | null>(null)
  const [articleEl, setArticleEl] = createSignal<HTMLElement | null>(null)

  createEffect(() => {
    const id = params.id
    if (!id) return
    const unsub = subscribeSpec(id, {
      onUpdated: () => setRefreshTick((t) => t + 1),
    })
    onCleanup(unsub)
  })

  // If we arrived from NewSpec, the draft run that just authored this spec is
  // streaming via /runs/<runId>/events. Re-register it with the global store
  // under the real specId so the dock keeps showing the output.
  createEffect(() => {
    const rid = search.runId
    if (!rid) return
    const title = spec()?.frontmatter.summary
    agentTasks.start({
      runId: rid,
      mode: 'skill-run',
      specId: params.id,
      specTitle: title,
      source: 'draft',
    })
    setSearch({ runId: undefined }, { replace: true })
  })

  createEffect(() => {
    const el = articleEl()
    if (!el) return
    const unsub = observeSelection(el, setSnap)
    onCleanup(unsub)
  })

  async function runAgent() {
    setRunError(null)
    try {
      const { runId } = await api.runAgent(params.id)
      agentTasks.start({
        runId,
        mode: 'skill-run',
        specId: params.id,
        specTitle: spec()?.frontmatter.summary,
        source: 'run',
      })
    } catch (err) {
      setRunError((err as Error).message)
    }
  }

  function openAnnotate(s: SelectionSnapshot) {
    setPopoverSnap(s)
    setPopoverOpen(true)
  }

  async function submitAnnotate(note: string) {
    const s = popoverSnap()
    if (!s) return
    await api.appendAnnotation(params.id, {
      sectionPath: s.sectionPath,
      quote: s.text,
      note,
    })
  }

  async function openExplain(s: SelectionSnapshot) {
    try {
      const { runId } = await api.explain(params.id, s.text)
      agentTasks.start({
        runId,
        mode: 'explain',
        specId: params.id,
        specTitle: spec()?.frontmatter.summary,
        source: 'explain',
      })
    } catch (err) {
      setRunError((err as Error).message)
    }
  }

  return (
    <section class="page">
      <Suspense fallback={<p class="muted">加载中…</p>}>
        <Show when={spec()} fallback={<p class="muted">spec 不存在或已删除</p>}>
          {(s) => {
            const running = () => agentTasks.hasRunningSkillRun(params.id)
            return (
              <>
                <header class="page-head detail-head">
                  <div>
                    <code class="id">{s().id}</code>
                    <h1>{titleFromBody(s().body) ?? '（待 Agent 补全）'}</h1>
                    <p class="summary">{s().frontmatter.summary || '（待 Agent 补全）'}</p>
                  </div>
                  <div class="meta">
                    <span class={`badge stage-${s().frontmatter.stage}`}>
                      {s().frontmatter.stage}
                    </span>
                    <time>{s().frontmatter.updated_at}</time>
                    <button
                      type="button"
                      class={`primary-action run-btn ${running() ? 'run-running' : 'run-idle'}`}
                      onClick={runAgent}
                      disabled={running()}
                    >
                      {running() ? '运行中…' : '运行 Agent'}
                    </button>
                  </div>
                </header>

                <Show when={runError()}>
                  <p class="error">{runError()}</p>
                </Show>

                <article class="markdown" ref={setArticleEl} innerHTML={renderMarkdown(s().body)} />

                <SelectionMenu
                  snap={popoverOpen() ? null : snap()}
                  onAnnotate={openAnnotate}
                  onExplain={openExplain}
                />
                <AnnotatePopover
                  open={popoverOpen()}
                  snap={popoverSnap()}
                  onCancel={() => setPopoverOpen(false)}
                  onSubmit={submitAnnotate}
                />
              </>
            )
          }}
        </Show>
      </Suspense>
    </section>
  )
}

function titleFromBody(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}
