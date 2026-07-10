import { createEffect, createSignal, onCleanup, Show, type Component } from 'solid-js'
import type { AppendItemBody, AppendItemKind } from '../lib/api.js'

interface Props {
  open: boolean
  sectionPath?: string
  quote?: string
  anchorEl?: HTMLElement
  onCancel: () => void
  onSubmit: (body: AppendItemBody) => Promise<void>
}

const KIND_LABEL: Record<AppendItemKind, string> = {
  feat: 'feat 新增/扩展需求',
  refct: 'refct 重构/重写/抽取',
  fix: 'fix 修复缺陷',
}

export const AppendTaskDialog: Component<Props> = (props) => {
  const [kind, setKind] = createSignal<AppendItemKind>('fix')
  const [description, setDescription] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [pos, setPos] = createSignal<{ top: number; left: number } | null>(null)

  createEffect(() => {
    if (!props.open) {
      setPos(null)
      return
    }
    const anchor = props.anchorEl
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    setPos({ top: rect.bottom + 8, left: rect.right })
  })

  createEffect(() => {
    if (!props.open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', handler)
    onCleanup(() => window.removeEventListener('keydown', handler))
  })

  function reset() {
    setKind('fix')
    setDescription('')
    setError(null)
  }

  async function submit(e: Event) {
    e.preventDefault()
    const desc = description().trim()
    if (!desc) {
      setError('描述不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit({
        kind: kind(),
        description: desc,
        sectionPath: props.sectionPath,
        quote: props.quote,
      })
      reset()
      props.onCancel()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    props.onCancel()
  }

  return (
    <Show when={props.open}>
      <div class="append-dialog-backdrop" onMouseDown={cancel}>
        <div
          class="append-dialog"
          role="dialog"
          aria-label="追加任务"
          style={
            pos()
              ? { top: `${pos()!.top}px`, right: `calc(100vw - ${pos()!.left}px)` }
              : undefined
          }
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header>
            <strong>追加任务</strong>
            <span class="muted">提交后将自动重开 plan 阶段，Agent 会续跑处理新增项</span>
          </header>
          <form onSubmit={submit}>
            <fieldset class="kind-group">
              <legend>类型</legend>
              {(['feat', 'refct', 'fix'] as const).map((k) => (
                <label class="kind-option">
                  <input
                    type="radio"
                    name="append-kind"
                    value={k}
                    checked={kind() === k}
                    onChange={() => setKind(k)}
                    disabled={busy()}
                  />
                  <span>{KIND_LABEL[k]}</span>
                </label>
              ))}
            </fieldset>

            <label class="field">
              <span>描述</span>
              <textarea
                rows={5}
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                placeholder="详细描述新增需求 / 重构意图 / 缺陷复现…"
                autofocus
                disabled={busy()}
              />
            </label>

            <Show when={props.sectionPath || props.quote}>
              <div class="reference">
                <Show when={props.sectionPath}>
                  <div>
                    <span class="muted">引用章节：</span>
                    <code>{props.sectionPath}</code>
                  </div>
                </Show>
                <Show when={props.quote}>
                  <blockquote class="quote">{props.quote?.slice(0, 200)}</blockquote>
                </Show>
              </div>
            </Show>

            {error() && <p class="error">{error()}</p>}

            <div class="actions">
              <button type="button" onClick={cancel} disabled={busy()}>
                取消
              </button>
              <button type="submit" class="primary-action" disabled={busy()}>
                {busy() ? '提交中…' : '提交并触发 Agent'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  )
}
