import {
  Show,
  Suspense,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { useParams } from '@solidjs/router'
import { api } from '../lib/api.js'
import { renderMarkdown } from '../lib/markdown.js'
import { subscribeSpec } from '../lib/sse.js'
import { observeSelection, type SelectionSnapshot } from '../lib/selection.js'
import { SelectionMenu } from '../components/SelectionMenu.jsx'
import { AnnotatePopover } from '../components/AnnotatePopover.jsx'
import { ExplainDrawer } from '../components/ExplainDrawer.jsx'

type RunStatus = 'idle' | 'running' | 'done' | 'failed'

export const SpecDetail: Component = () => {
  const params = useParams<{ id: string }>()
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [spec, { refetch }] = createResource(
    () => [params.id, refreshTick()] as const,
    async ([id]) => api.getSpec(id),
  )

  const [snap, setSnap] = createSignal<SelectionSnapshot | null>(null)
  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const [popoverSnap, setPopoverSnap] = createSignal<SelectionSnapshot | null>(null)

  const [runStatus, setRunStatus] = createSignal<RunStatus>('idle')
  const [runError, setRunError] = createSignal<string | null>(null)
  const [runId, setRunId] = createSignal<string | null>(null)
  const [logOpen, setLogOpen] = createSignal(false)
  const [log, setLog] = createSignal('')

  const [explainOpen, setExplainOpen] = createSignal(false)
  const [explainStatus, setExplainStatus] = createSignal<
    'pending' | 'streaming' | 'done' | 'failed'
  >('pending')
  const [explainText, setExplainText] = createSignal('')
  const [explainRunId, setExplainRunId] = createSignal<string | null>(null)

  const [articleEl, setArticleEl] = createSignal<HTMLElement | null>(null)

  createEffect(() => {
    const id = params.id
    if (!id) return
    const unsub = subscribeSpec(id, {
      onUpdated: () => setRefreshTick((t) => t + 1),
      onAgentStdout: (e) => {
        if (e.mode === 'skill-run' && e.runId === runId()) {
          setLog((s) => s + e.chunk)
          setRunStatus('running')
        } else if (e.mode === 'explain' && e.runId === explainRunId()) {
          setExplainStatus('streaming')
          setExplainText((s) => s + e.chunk)
        }
      },
      onAgentExit: (e) => {
        if (e.mode === 'skill-run' && e.runId === runId()) {
          setRunStatus(e.code === 0 ? 'done' : 'failed')
        } else if (e.mode === 'explain' && e.runId === explainRunId()) {
          setExplainStatus(e.code === 0 ? 'done' : 'failed')
        }
      },
      onAgentError: (e) => {
        if (e.mode === 'skill-run' && e.runId === runId()) {
          setRunError(e.message)
          setRunStatus('failed')
        } else if (e.mode === 'explain' && e.runId === explainRunId()) {
          setExplainStatus('failed')
        }
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

  async function runAgent() {
    setRunError(null)
    setLog('')
    setRunStatus('running')
    setLogOpen(true)
    try {
      const { runId: id } = await api.runAgent(params.id)
      setRunId(id)
    } catch (err) {
      setRunError((err as Error).message)
      setRunStatus('failed')
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
    setExplainText('')
    setExplainStatus('pending')
    setExplainOpen(true)
    try {
      const { runId: id } = await api.explain(params.id, s.text)
      setExplainRunId(id)
    } catch (err) {
      setExplainStatus('failed')
      setExplainText((err as Error).message)
    }
  }

  return (
    <section class="page">
      <Suspense fallback={<p class="muted">加载中…</p>}>
        <Show when={spec()} fallback={<p class="muted">spec 不存在或已删除</p>}>
          {(s) => (
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
                    class={`primary-action run-btn run-${runStatus()}`}
                    onClick={runAgent}
                    disabled={runStatus() === 'running'}
                  >
                    {runStatus() === 'idle' && '运行 Agent'}
                    {runStatus() === 'running' && '运行中…'}
                    {runStatus() === 'done' && '已完成（再次运行）'}
                    {runStatus() === 'failed' && '失败（重试）'}
                  </button>
                </div>
              </header>

              <Show when={runStatus() !== 'idle'}>
                <section class="run-log">
                  <button
                    type="button"
                    class="run-log-toggle"
                    onClick={() => setLogOpen((v) => !v)}
                  >
                    {logOpen() ? '收起' : '展开'} 执行日志
                  </button>
                  <Show when={logOpen()}>
                    <pre class="run-log-body">{log() || '（等待输出…）'}</pre>
                    {runError() && <p class="error">{runError()}</p>}
                  </Show>
                </section>
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
              <ExplainDrawer
                open={explainOpen()}
                status={explainStatus()}
                text={explainText()}
                onClose={() => setExplainOpen(false)}
              />
            </>
          )}
        </Show>
      </Suspense>
    </section>
  )
}

function titleFromBody(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}
