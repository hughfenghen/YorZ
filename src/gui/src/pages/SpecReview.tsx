import {
  For,
  Show,
  Suspense,
  createMemo,
  createResource,
  createSignal,
  type Component,
} from 'solid-js'
import { A, useParams } from '@solidjs/router'
import { api, type GitChange, type SpecDetail } from '../lib/api.js'
import { projectHref } from '../lib/project.js'

export const SpecReview: Component = () => {
  const params = useParams<{ id: string }>()
  const [spec] = createResource(
    () => params.id,
    (id) => api.getSpec(id),
  )
  const [refreshTick, setRefreshTick] = createSignal(0)
  const [changes] = createResource(
    () => [params.id, refreshTick()] as const,
    async ([id]) => api.listSpecChanges(id),
  )

  const [draft, setDraft] = createSignal<string | null>(null)
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [success, setSuccess] = createSignal<{ commit: string } | null>(null)

  const defaultMessage = createMemo(() => buildDefaultMessage(spec(), params.id))
  const message = () => draft() ?? defaultMessage()

  const list = createMemo(() => changes()?.changes ?? [])
  const empty = createMemo(() => !changes.loading && list().length === 0)

  async function submit() {
    setError(null)
    setSuccess(null)
    const trimmed = message().trim()
    if (!trimmed) {
      setError('提交信息不能为空')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.commitSpecChanges(params.id, { message: trimmed })
      setSuccess({ commit: res.commit })
      setDraft(null)
      setRefreshTick((t) => t + 1)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section class="page spec-review">
      <Suspense fallback={<p class="muted">加载中…</p>}>
        <header class="page-head detail-head">
          <div>
            <A class="ghost" href={projectHref(`specs/${params.id}`)}>
              ← 返回 spec
            </A>
            <h1>Review · {params.id}</h1>
            <p class="summary">{spec()?.frontmatter.summary || '（待 Agent 补全）'}</p>
          </div>
        </header>

        <section class="review-changes">
          <h2>变更文件</h2>
          <Show when={!empty()} fallback={<p class="muted">暂无 Agent 本次写入的未提交改动</p>}>
            <ul class="change-list">
              <For each={list()}>
                {(change) => (
                  <li>
                    <span class={`status-badge status-${badgeClass(change.status)}`}>
                      {change.status}
                    </span>
                    <code class="path">{change.path}</code>
                    <Show when={change.renamedFrom}>
                      <span class="muted"> ← {change.renamedFrom}</span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section class="review-commit">
          <h2>提交</h2>
          <textarea
            class="commit-message"
            rows="4"
            value={message()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            placeholder="commit message"
          />
          <div class="commit-actions">
            <button
              type="button"
              class="primary-action"
              disabled={empty() || submitting()}
              onClick={submit}
            >
              {submitting() ? '提交中…' : '提交到 git'}
            </button>
          </div>
          <Show when={success()}>
            <p class="success">提交成功：{success()!.commit.slice(0, 7)}</p>
          </Show>
          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>
        </section>
      </Suspense>
    </section>
  )
}

function buildDefaultMessage(spec: SpecDetail | undefined, specId: string): string {
  const type = inferType(specId)
  const summary = (spec?.frontmatter.summary ?? '').trim().slice(0, 100) || '(待 Agent 补全)'
  return `${type}(${specId}): ${summary}`
}

function inferType(specId: string): string {
  const parts = specId.split('.')
  const t = parts[1]
  return t === 'feat' || t === 'fix' || t === 'refct' ? t : 'feat'
}

function badgeClass(status: string): string {
  if (status === '??') return 'untracked'
  return status.toLowerCase()
}
