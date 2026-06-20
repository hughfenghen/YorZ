import { createSignal, Show, type Component } from 'solid-js'
import type { SelectionSnapshot } from '../lib/selection.js'

interface Props {
  open: boolean
  snap: SelectionSnapshot | null
  onCancel: () => void
  onSubmit: (note: string) => Promise<void>
}

const POPOVER_WIDTH = 500

export const AnnotatePopover: Component<Props> = (props) => {
  const [note, setNote] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const position = () => {
    const snap = props.snap
    if (!snap) return { top: 0, left: 0 }
    const top = snap.rect.bottom + 8
    const left = Math.min(Math.max(8, snap.rect.left), window.innerWidth - POPOVER_WIDTH - 8)
    return { top, left }
  }

  async function submit(e: Event) {
    e.preventDefault()
    if (!note().trim()) return
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit(note().trim())
      setNote('')
      props.onCancel()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={props.open && props.snap}>
      <div
        class="annotate-popover"
        style={{
          top: `${position().top}px`,
          left: `${position().left}px`,
          width: `${POPOVER_WIDTH}px`,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <strong>批注</strong>
        </header>
        <blockquote class="quote">
          <em>{props.snap?.sectionPath}</em> 中 “{(props.snap?.text ?? '').slice(0, 200)}”
        </blockquote>
        <form onSubmit={submit}>
          <textarea
            rows={3}
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
            placeholder="写下你对这段文本的批注…"
            autofocus
          />
          {error() && <p class="error">{error()}</p>}
          <div class="actions">
            <button type="button" onClick={props.onCancel}>
              取消
            </button>
            <button type="submit" class="primary-action" disabled={busy()}>
              {busy() ? '提交中…' : '提交批注'}
            </button>
          </div>
        </form>
      </div>
    </Show>
  )
}
