import {
  Show,
  Suspense,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  startTransition,
  type Component,
} from 'solid-js'
import { A, useParams } from '@solidjs/router'
import {
  api,
  type AppendItemBody,
  type QuestionAnswersBody,
  type SpecDetail as SpecDetailDoc,
  type SpecStage,
} from '../lib/api.js'
import { Copy } from 'lucide-solid'
import { projectHref, requestChatSession, useCurrentProjectId } from '../lib/project.js'
import { useFocusModePage } from '../lib/layout-focus.js'
import morphdom from 'morphdom'
import { renderMarkdown } from '../lib/markdown.js'
import { renderMermaidIn } from '../lib/mermaid.js'
import { subscribeSpec, subscribeSession, subscribeSessions } from '../lib/sse.js'
import { observeSelection, type SelectionSnapshot } from '../lib/selection.js'
import { formatSpecUpdatedAt } from '../lib/time.js'
import { parseConfirmQuestions } from '../lib/question-parse.js'
import { SelectionMenu } from '../components/SelectionMenu.jsx'
import { AnnotatePopover } from '../components/AnnotatePopover.jsx'
import { AppendTaskDialog } from '../components/AppendTaskDialog.jsx'
import { QuestionConfirmPanel, type FreeformDraft } from '../components/QuestionConfirmPanel.jsx'
import { Breadcrumb } from '../components/Breadcrumb.jsx'
import { FocusModeButton } from '../components/FocusModeButton.jsx'
import { Button } from '../components/ui/button.jsx'
import { Badge } from '../components/ui/badge.jsx'
import { toast } from '../components/ui/sonner.jsx'
import { t } from '../i18n/index.js'

const STAGE_BG: Record<string, string> = {
  plan: 'bg-stage-plan',
  tasks: 'bg-stage-tasks',
  execute: 'bg-stage-execute',
  done: 'bg-stage-done',
}

/** Coalesce the SSE event storm an agent's successive writes produce. */
const SSE_DEBOUNCE_MS = 120
const FETCH_RETRIES = 3
const FETCH_BACKOFF_MS = 150

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Agents and editors write atomically (temp file → rename), so a refetch landing
 * inside that window sees the file as missing and the API answers 404. Retry a
 * few times, and if it still fails fall back to the last good document rather
 * than throwing — an unhandled fetcher rejection strands `Suspense` on its
 * loading fallback forever. Only a spec we never loaded resolves to `null`
 * (the genuine not-found case).
 */
async function fetchSpecWithRetry(
  pid: string,
  id: string,
  prev: SpecDetailDoc | null | undefined,
): Promise<SpecDetailDoc | null> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      return await api.getSpec(pid, id)
    } catch (err) {
      const is404 = (err as Error).message.startsWith('404')
      if (!is404) throw err
      if (attempt < FETCH_RETRIES) await sleep(FETCH_BACKOFF_MS)
    }
  }
  return prev ?? null
}

export const SpecDetail: Component = () => {
  const params = useParams<{ id: string }>()
  const projectId = useCurrentProjectId()
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [running, setRunning] = createSignal(false)
  const [specSid, setSpecSid] = createSignal('')
  const [spec] = createResource<SpecDetailDoc | null, readonly [string, string, number]>(
    () => [projectId(), params.id, refreshTick()] as const,
    async ([pid, id], info) => fetchSpecWithRetry(pid, id, info.value),
  )
  // Drives the "Debug" entry next to Review: only shown when debug.md exists.
  const [debugDoc] = createResource(
    () => [projectId(), params.id, refreshTick()] as const,
    async ([pid, id]) => {
      try {
        return await api.getDebug(pid, id)
      } catch {
        return { exists: false, text: '' }
      }
    },
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
  const specFilePath = createMemo(() => `@.yorz/specs/${params.id}/spec.md`)

  // Annotations are drafted at any stage, so the panel is gated on having
  // something to submit — but NEVER while the spec's agent is running: a visible
  // panel could be submitted again and spin up a second session that concurrently
  // rewrites the same doc. `freeforms` drafts are only hidden, not cleared, so
  // they reappear once the run finishes.
  const showPanel = createMemo(() => {
    const s = spec()
    if (!s) return false
    if (running()) return false
    return questions().length > 0 || freeforms().length > 0
  })

  createEffect(() => {
    const id = params.id
    const pid = projectId()
    if (!id || !pid) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = subscribeSpec(pid, id, {
      onUpdated: () => {
        if (timer) clearTimeout(timer)
        // Refresh inside a transition so the resource refetch does NOT re-suspend
        // <Suspense>: re-suspending detaches and reattaches the <article> scroll
        // container, and reattaching resets scrollTop to 0. A transition keeps the
        // current DOM mounted until the new doc is ready, preserving scroll.
        timer = setTimeout(
          () => void startTransition(() => setRefreshTick((t) => t + 1)),
          SSE_DEBOUNCE_MS,
        )
      },
    })
    onCleanup(() => {
      if (timer) clearTimeout(timer)
      unsub()
    })
  })

  // Resolve this spec's dedicated session (if one already exists) and ask the
  // Chat panel to switch to it, so system rounds (run / explain / review /
  // git-ops) show up there. Sessions are created lazily — when none is bound
  // yet the probe returns null and Chat is left exactly as it is.
  createEffect(() => {
    const id = params.id
    const pid = projectId()
    if (!id || !pid) return
    void api
      .getSpecSession(pid, id)
      .then(({ sessionId, running: r }) => {
        if (!sessionId) return
        setSpecSid(sessionId)
        // Backfill the initial run state so a page opened while a background turn
        // is already in flight starts with the panel hidden.
        setRunning(r)
        requestChatSession(sessionId)
      })
      .catch(() => {})
  })

  // Keep `running` authoritative for this spec's session. The project-level
  // `session-status` topic reports both start (→true) and finish (→false),
  // including turns kicked off elsewhere; the single-session stream below only
  // ever settles it to false. Neither replays a snapshot, hence the probe above.
  createEffect(() => {
    const pid = projectId()
    const sid = specSid()
    if (!pid || !sid) return
    const unsub = subscribeSessions(pid, {
      onStatus: (ev) => {
        if (ev.sessionId === sid) setRunning(ev.running)
      },
    })
    onCleanup(unsub)
  })

  // Drive the slim running indicator from the spec session's turn lifecycle.
  createEffect(() => {
    const pid = projectId()
    const sid = specSid()
    if (!pid || !sid) return
    const unsub = subscribeSession(pid, sid, {
      onEvent: (ev) => {
        if (ev.type === 'turn-completed' || ev.type === 'error') setRunning(false)
      },
    })
    onCleanup(unsub)
  })

  createEffect(() => {
    const el = articleEl()
    if (!el) return
    const unsub = observeSelection(el, setSnap)
    onCleanup(unsub)
  })

  // Focus mode is page-scoped: leaving the page restores the chrome, and Escape
  // exits unless a page-level popover/dialog should consume the key first.
  useFocusModePage(() => appendOpen() || popoverOpen())

  // Re-render on every spec() change via INCREMENTAL DOM DIFF (morphdom): only the
  // nodes that actually changed are patched; unchanged nodes (including already
  // rendered mermaid SVGs) stay in place. Because most nodes don't move, the
  // browser's native scroll anchoring keeps the viewport pinned to the reading
  // position on its own — so no manual scrollTop record/restore and no offscreen
  // double-buffer are needed. The earlier full replaceChildren swap collapsed the
  // body height to 0 on every refresh (no stable anchor), which is why manual
  // scrollTop was required; a diff never collapses the height.
  //
  // `onBeforeElUpdated` skips mermaid nodes whose source is unchanged: morphdom
  // would otherwise overwrite the rendered SVG with the raw placeholder. Only
  // new/changed mermaid nodes (raw, without data-processed) are then rendered.
  createEffect(() => {
    const el = articleEl()
    const s = spec()
    if (!el || !s) return
    const pid = projectId()

    let active = true
    let cleanupFn: (() => void) | undefined

    const html = renderMarkdown(s.body, { specId: s.id, projectId: pid || undefined })
    morphdom(el, `<article>${html}</article>`, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        // Preserve an already-rendered mermaid diagram when its source is unchanged:
        // returning false leaves `fromEl` (the SVG) untouched instead of reverting
        // it to the incoming raw placeholder.
        if (
          fromEl.classList?.contains('mermaid') &&
          fromEl.getAttribute('data-mermaid-source') ===
            (toEl as Element).getAttribute?.('data-mermaid-source')
        ) {
          return false
        }
        return true
      },
    })

    void renderMermaidIn(el).then((cleanup) => {
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

  async function runAgent() {
    setRunError(null)
    setRunning(true)
    try {
      const pid = projectId()
      const { sessionId } = await api.runAgent(pid, params.id)
      setSpecSid(sessionId)
      requestChatSession(sessionId)
    } catch (err) {
      setRunning(false)
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

  async function copySpecPath() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(specFilePath())
      toast.success(t('specDetail.specPathCopied'))
    } catch {
      toast.error(t('specDetail.specPathCopyFailed'))
    }
  }

  function openAnnotate(s: SelectionSnapshot) {
    setPopoverSnap(s)
    setPopoverOpen(true)
  }

  // Every annotation — at every stage — becomes a draft in the confirm panel, so
  // several can be accumulated and submitted in one go (which then runs the agent).
  // Submitting via `applyQuestionAnswers` also forces the spec back to `plan`, the
  // same "reopen the flow" semantics `appendAnnotation` already had.
  async function submitAnnotate(note: string) {
    const s = popoverSnap()
    if (!s) return
    setFreeforms((prev) => [
      ...prev,
      {
        id: `f-${Date.now()}-${prev.length}`,
        sectionPath: s.sectionPath,
        quote: s.text,
        note,
      },
    ])
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
    if (res.sessionId) {
      setRunning(true)
      setSpecSid(res.sessionId)
      requestChatSession(res.sessionId)
    }
  }

  async function openExplain(s: SelectionSnapshot) {
    setRunning(true)
    try {
      const pid = projectId()
      const { sessionId } = await api.explain(pid, params.id, s.text)
      setSpecSid(sessionId)
      requestChatSession(sessionId)
    } catch (err) {
      setRunning(false)
      setRunError((err as Error).message)
    }
  }

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <Suspense fallback={<p class="text-muted-foreground">{t('common.loading')}</p>}>
        <Show
          when={spec()}
          fallback={<p class="text-muted-foreground">{t('specDetail.notFound')}</p>}
        >
          {(s) => {
            return (
              <>
                <header class="flex flex-col items-start justify-between gap-2">
                  <div class="flex w-full items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-1">
                      <Breadcrumb
                        items={[
                          { label: t('breadcrumb.specList'), href: projectHref('') },
                          { label: s().id },
                        ]}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-7 w-7 shrink-0"
                        title={t('specDetail.copySpecPath')}
                        aria-label={t('specDetail.copySpecPath')}
                        onClick={() => void copySpecPath()}
                      >
                        <Copy class="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <FocusModeButton />
                  </div>
                  <div>
                    <p class=" text-muted-foreground">
                      {s().frontmatter.summary || t('common.pendingAgent')}
                    </p>
                  </div>
                  <div class="flex items-center gap-2 text-muted-foreground">
                    <select
                      class={`cursor-pointer appearance-none rounded-full border-0 px-2.5 py-0.5 text-sm font-semibold uppercase text-white ${
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
                      class="inline-flex h-8 cursor-pointer items-center justify-center rounded-md px-3 font-medium hover:bg-accent hover:text-accent-foreground"
                      href={projectHref(`specs/${s().id}/review`)}
                    >
                      {t('specDetail.review')}
                    </A>
                    <Show when={debugDoc()?.exists}>
                      <A
                        class="inline-flex h-8 cursor-pointer items-center justify-center rounded-md px-3 font-medium hover:bg-accent hover:text-accent-foreground"
                        href={projectHref(`specs/${s().id}/debug`)}
                      >
                        {t('specDetail.debug')}
                      </A>
                    </Show>
                    <Show when={running()}>
                      <Badge variant="secondary">{t('specDetail.running')}</Badge>
                    </Show>
                  </div>
                </header>

                <Show when={runError()}>
                  <p class="text-destructive ">{runError()}</p>
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
                  {/* Content is injected by the markdown+mermaid effect above. */}
                  <article
                    class="markdown spec-main flex-[6] min-w-0 overflow-auto rounded-xl border bg-card p-4 shadow"
                    ref={setArticleEl}
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
