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
import { api, type AppendItemBody, type QuestionAnswersBody, type SpecStage } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { renderMarkdown } from '../lib/markdown.js'
import { renderMermaidIn } from '../lib/mermaid.js'
import { subscribeSpec } from '../lib/sse.js'
import { agentTasks } from '../lib/agent-tasks.js'
import { observeSelection, type SelectionSnapshot } from '../lib/selection.js'
import { formatSpecUpdatedAt } from '../lib/time.js'
import { parseConfirmQuestions } from '../lib/question-parse.js'
import { SelectionMenu } from '../components/SelectionMenu.jsx'
import { AnnotatePopover } from '../components/AnnotatePopover.jsx'
import { AppendTaskDialog } from '../components/AppendTaskDialog.jsx'
import { QuestionConfirmPanel, type FreeformDraft } from '../components/QuestionConfirmPanel.jsx'
import { Button } from '../components/ui/button.jsx'
import { Badge } from '../components/ui/badge.jsx'
import { t } from '../i18n/index.js'

const STAGE_BG: Record<string, string> = {
  plan: 'bg-stage-plan',
  tasks: 'bg-stage-tasks',
  execute: 'bg-stage-execute',
  done: 'bg-stage-done',
}

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

  async function changeStage(stage: SpecStage) {
    setRunError(null)
    try {
      await api.setStage(projectId(), params.id, stage)
      setRefreshTick((t) => t + 1)
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
    <section class="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <Suspense fallback={<p class="text-muted-foreground">{t('common.loading')}</p>}>
        <Show
          when={spec()}
          fallback={<p class="text-muted-foreground">{t('specDetail.notFound')}</p>}
        >
          {(s) => {
            const running = () => agentTasks.hasRunningSkillRun(params.id)
            return (
              <>
                <header class="flex flex-col items-start justify-between">
                  <div>
                    <code class="font-mono text-xs text-muted-foreground">{s().id}</code>
                    <h1 class="m-0 text-xl">
                      {titleFromBody(s().body) ?? t('common.pendingAgent')}
                    </h1>
                    <p class="text-sm text-muted-foreground">
                      {s().frontmatter.summary || t('common.pendingAgent')}
                    </p>
                  </div>
                  <div class="flex items-center gap-2 text-sm text-muted-foreground">
                    <select
                      class={`cursor-pointer appearance-none rounded-full border-0 px-2.5 py-0.5 text-xs font-semibold uppercase text-white ${
                        STAGE_BG[s().frontmatter.stage] ?? 'bg-muted'
                      }`}
                      value={s().frontmatter.stage}
                      onChange={(e) => changeStage(e.currentTarget.value as SpecStage)}
                      title={t('specDetail.forceStage')}
                    >
                      <option value="plan">plan</option>
                      <option value="tasks">tasks</option>
                      <option value="execute">execute</option>
                      <option value="done">done</option>
                    </select>
                    <time>{formatSpecUpdatedAt(s().frontmatter.updated_at)}</time>
                    <Button
                      variant="outline"
                      size="sm"
                      class="append-btn"
                      ref={appendBtnEl}
                      onClick={openAppend}
                    >
                      {t('specDetail.appendTask')}
                    </Button>
                    <A
                      class="inline-flex h-8 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                      href={projectHref(`specs/${s().id}/agent-logs`)}
                    >
                      {t('specDetail.agentLogs')}
                    </A>
                    <A
                      class="inline-flex h-8 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                      href={projectHref(`specs/${s().id}/review`)}
                    >
                      {t('specDetail.review')}
                    </A>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={runAgent}
                      disabled={running()}
                      class={running() ? 'opacity-85' : ''}
                    >
                      {running() ? t('specDetail.running') : t('specDetail.runAgent')}
                    </Button>
                  </div>
                </header>

                <Show when={runError()}>
                  <p class="text-destructive text-sm">{runError()}</p>
                </Show>

                <div class="flex min-h-0 flex-1 items-stretch gap-4">
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
                    class="markdown spec-main flex-[6] min-w-0 overflow-auto rounded-xl border bg-card p-4 shadow"
                    ref={setArticleEl}
                    innerHTML={renderMarkdown(s().body, {
                      specId: s().id,
                      projectId: projectId() || undefined,
                    })}
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
