import {
  Show,
  Suspense,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { A, useParams, useSearchParams } from '@solidjs/router'
import { api, type AppendItemBody, type QuestionAnswersBody } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { renderMarkdown } from '../lib/markdown.js'
import { renderMermaidIn } from '../lib/mermaid.js'
import { subscribeSpec } from '../lib/sse.js'
import { agentTasks } from '../lib/agent-tasks.js'
import { observeSelection, type SelectionSnapshot } from '../lib/selection.js'
import { parseConfirmQuestions } from '../lib/question-parse.js'
import { SelectionMenu } from '../components/SelectionMenu.jsx'
import { AnnotatePopover } from '../components/AnnotatePopover.jsx'
import { AppendTaskDialog } from '../components/AppendTaskDialog.jsx'
import { QuestionConfirmPanel, type FreeformDraft } from '../components/QuestionConfirmPanel.jsx'

export const SpecDetail: Component = () => {
  const params = useParams<{ id: string }>()
  const projectId = useCurrentProjectId()
  const [search, setSearch] = useSearchParams<{ runId?: string }>()
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [spec] = createResource(
    () => [projectId(), params.id, refreshTick()] as const,
    async ([pid, id]) => api.getSpec(pid, id),
  )

  const [snap, setSnap] = createSignal<SelectionSnapshot | null>(null)
  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const [popoverSnap, setPopoverSnap] = createSignal<SelectionSnapshot | null>(null)
  const [runError, setRunError] = createSignal<string | null>(null)
  const [articleEl, setArticleEl] = createSignal<HTMLElement | null>(null)
  const [freeforms, setFreeforms] = createSignal<FreeformDraft[]>([])
  const [appendOpen, setAppendOpen] = createSignal(false)
  const [appendSnap, setAppendSnap] = createSignal<SelectionSnapshot | null>(null)
  let appendBtnEl: HTMLButtonElement | undefined

  const questions = createMemo(() => {
    const s = spec()
    if (!s) return []
    return parseConfirmQuestions(s.body)
  })

  const showPanel = createMemo(() => {
    const s = spec()
    if (!s) return false
    if (s.frontmatter.stage !== 'plan') return false
    return questions().length > 0 || freeforms().length > 0
  })

  createEffect(() => {
    const id = params.id
    const pid = projectId()
    if (!id || !pid) return
    const unsub = subscribeSpec(pid, id, {
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
      projectId: projectId(),
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

  createEffect(() => {
    const el = articleEl()
    if (!el) return
    let active = true
    let cleanupFn: (() => void) | undefined
    void renderMermaidIn(el).then((cleanup) => {
      if (active) cleanupFn = cleanup
      else cleanup()
    })
    onCleanup(() => {
      active = false
      cleanupFn?.()
    })
  })

  async function runAgent() {
    setRunError(null)
    try {
      const pid = projectId()
      const { runId } = await api.runAgent(pid, params.id)
      agentTasks.start({
        runId,
        projectId: pid,
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
    const stage = spec()?.frontmatter.stage
    if (stage === 'plan') {
      setFreeforms((prev) => [
        ...prev,
        {
          id: `f-${Date.now()}-${prev.length}`,
          sectionPath: s.sectionPath,
          quote: s.text,
          note,
        },
      ])
      return
    }
    await api.appendAnnotation(projectId(), params.id, {
      sectionPath: s.sectionPath,
      quote: s.text,
      note,
    })
  }

  function removeFreeform(id: string) {
    setFreeforms((prev) => prev.filter((f) => f.id !== id))
  }

  async function submitAnswers(payload: QuestionAnswersBody) {
    await api.submitQuestionAnswers(projectId(), params.id, payload)
    setFreeforms([])
    await runAgent()
  }

  function openAppend() {
    setAppendSnap(snap())
    setAppendOpen(true)
  }

  async function submitAppend(body: AppendItemBody) {
    const pid = projectId()
    const res = await api.appendItem(pid, params.id, body)
    if (res.runId) {
      agentTasks.start({
        runId: res.runId,
        projectId: pid,
        mode: 'skill-run',
        specId: params.id,
        specTitle: spec()?.frontmatter.summary,
        source: 'run',
      })
    }
  }

  async function openExplain(s: SelectionSnapshot) {
    try {
      const pid = projectId()
      const { runId } = await api.explain(pid, params.id, s.text)
      agentTasks.start({
        runId,
        projectId: pid,
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
                    <button type="button" class="append-btn" ref={appendBtnEl} onClick={openAppend}>
                      追加任务
                    </button>
                    <A class="ghost agent-logs-link" href={projectHref(`specs/${s().id}/agent-logs`)}>
                      执行日志
                    </A>
                    <A class="ghost review-link" href={projectHref(`specs/${s().id}/review`)}>
                      Review
                    </A>
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

                <div class="spec-split">
                  <Show when={showPanel()}>
                    <QuestionConfirmPanel
                      questions={questions()}
                      freeforms={freeforms()}
                      running={running()}
                      onRemoveFreeform={removeFreeform}
                      onSubmit={submitAnswers}
                    />
                  </Show>
                  <article
                    class="markdown spec-main"
                    ref={setArticleEl}
                    innerHTML={renderMarkdown(s().body, { specId: s().id })}
                  />
                </div>

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
                <AppendTaskDialog
                  open={appendOpen()}
                  sectionPath={appendSnap()?.sectionPath}
                  quote={appendSnap()?.text}
                  anchorEl={appendBtnEl}
                  onCancel={() => setAppendOpen(false)}
                  onSubmit={submitAppend}
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
