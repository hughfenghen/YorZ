import { createSignal, Show, type Component } from 'solid-js'
import type { SelectionSnapshot } from '../lib/selection.js'

interface Props {
  open: boolean
  snap: SelectionSnapshot | null
  onCancel: () => void
  onSubmit: (note: string) => Promise<void>
}

const POPOVER_WIDTH = 500
const POPOVER_MARGIN = 8

export const AnnotatePopover: Component<Props> = (props) => {
  const [note, setNote] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [measuredHeight, setMeasuredHeight] = createSignal(0)

  const position = () => {
    const snap = props.snap
    if (!snap) return { top: 0, left: 0 }
    const height = measuredHeight() || 260
    const vh = window.innerHeight
    const below = snap.rect.bottom + POPOVER_MARGIN
    const above = snap.rect.top - POPOVER_MARGIN - height
    let top: number
    if (below + height <= vh - POPOVER_MARGIN) {
      top = below
    } else if (above >= POPOVER_MARGIN) {
      top = above
    } else {
      top = Math.max(POPOVER_MARGIN, vh - height - POPOVER_MARGIN)
    }
    const left = Math.min(
      Math.max(POPOVER_MARGIN, snap.rect.left),
      window.innerWidth - POPOVER_WIDTH - POPOVER_MARGIN,
    )
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
        ref={(el) => {
          queueMicrotask(() => {
            if (el.offsetHeight !== measuredHeight()) {
              setMeasuredHeight(el.offsetHeight)
            }
          })
        }}
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
