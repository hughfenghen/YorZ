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

export const SpecDetail: Component = () => {
  const params = useParams<{ id: string }>()
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [spec, { refetch }] = createResource(
    () => [params.id, refreshTick()] as const,
    async ([id]) => api.getSpec(id),
  )

  createEffect(() => {
    const id = params.id
    if (!id) return
    const unsub = subscribeSpec(id, () => setRefreshTick((t) => t + 1))
    onCleanup(unsub)
  })

  const [note, setNote] = createSignal('')
  const [noteError, setNoteError] = createSignal<string | null>(null)
  const [noteBusy, setNoteBusy] = createSignal(false)

  async function appendNote(e: Event) {
    e.preventDefault()
    if (!note().trim()) return
    setNoteBusy(true)
    setNoteError(null)
    try {
      await api.appendNote(params.id, note().trim())
      setNote('')
      await refetch()
    } catch (err) {
      setNoteError((err as Error).message)
    } finally {
      setNoteBusy(false)
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
                  <h1>{titleFromBody(s().body) ?? s().frontmatter.summary}</h1>
                  <p class="summary">{s().frontmatter.summary}</p>
                </div>
                <div class="meta">
                  <span class={`badge stage-${s().frontmatter.stage}`}>
                    {s().frontmatter.stage}
                  </span>
                  <time>{s().frontmatter.updated_at}</time>
                </div>
              </header>
              <article class="markdown" innerHTML={renderMarkdown(s().body)} />
              <form class="note-form" onSubmit={appendNote}>
                <h3>追加批注</h3>
                <p class="muted">
                  追加的内容会以 <code>&gt; 用户批注（YYYY-MM-DD）：…</code> 形式写入正文末尾。
                </p>
                <textarea
                  rows={3}
                  value={note()}
                  onInput={(e) => setNote(e.currentTarget.value)}
                  placeholder="例如：！！！ 接受方案 A"
                />
                {noteError() && <p class="error">{noteError()}</p>}
                <button type="submit" class="primary-action" disabled={noteBusy()}>
                  {noteBusy() ? '提交中…' : '追加'}
                </button>
              </form>
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
