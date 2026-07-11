import { Show, type Component } from 'solid-js'
import type { SelectionSnapshot } from '../lib/selection.js'
import { Button } from './ui/button.jsx'
import { t } from '../i18n/index.js'

interface Props {
  snap: SelectionSnapshot | null
  onAnnotate: (snap: SelectionSnapshot) => void
  onExplain: (snap: SelectionSnapshot) => void
}

const MENU_HEIGHT = 36
const MENU_WIDTH = 140

export const SelectionMenu: Component<Props> = (props) => {
  const position = () => {
    const snap = props.snap
    if (!snap) return { top: 0, left: 0, visible: false }
    const top = snap.rect.top - MENU_HEIGHT - 8
    const left = snap.rect.left
    const safeTop = top < 8 ? snap.rect.bottom + 8 : top
    const safeLeft = Math.min(Math.max(8, left), window.innerWidth - MENU_WIDTH - 8)
    return { top: safeTop, left: safeLeft, visible: true }
  }

  return (
    <Show when={props.snap}>
      {(snap) => {
        const p = position()
        return (
          <div
            class="selection-menu fixed z-50 flex gap-1 rounded-md border bg-popover p-1 shadow-md"
            style={{
              top: `${p.top}px`,
              left: `${p.left}px`,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <Button variant="ghost" size="sm" onClick={() => props.onAnnotate(snap())}>
              {t('selectionMenu.annotate')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => props.onExplain(snap())}>
              {t('selectionMenu.explain')}
            </Button>
          </div>
        )
      }}
    </Show>
  )
}
