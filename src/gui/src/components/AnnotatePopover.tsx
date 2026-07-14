import { createSignal, Show, type Component } from 'solid-js'
import type { SelectionSnapshot } from '../lib/selection.js'
import { Button } from './ui/button.jsx'
import { Textarea } from './ui/textarea.jsx'
import { t } from '../i18n/index.js'

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
        class="fixed z-[60] flex max-h-[calc(100vh-16px)] flex-col gap-2.5 overflow-auto rounded-lg border bg-card p-3.5 shadow-xl"
        style={{
          top: `${position().top}px`,
          left: `${position().left}px`,
          width: `${POPOVER_WIDTH}px`,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header class="flex flex-col gap-0.5">
          <strong>{t('annotate.title')}</strong>
        </header>
        <blockquote class="m-0 border-l-2 border-border bg-background px-2.5 py-1.5 text-[0.9em] text-muted-foreground">
          <em>{props.snap?.sectionPath}</em> {t('annotate.inSection')} "
          {(props.snap?.text ?? '').slice(0, 200)}"
        </blockquote>
        <form onSubmit={submit}>
          <Textarea
            rows={3}
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
            placeholder={t('annotate.placeholder')}
            class="resize-y min-h-[64px]"
            autofocus
          />
          {error() && <p class="text-destructive ">{error()}</p>}
          <div class="mt-3 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={props.onCancel}>
              {t('common.cancel')}
            </Button>
            <Button variant="default" type="submit" disabled={busy() || !note().trim()}>
              {busy() ? t('common.submitting') : t('annotate.submit')}
            </Button>
          </div>
        </form>
      </div>
    </Show>
  )
}
