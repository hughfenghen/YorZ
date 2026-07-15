import { Show, type Component } from 'solid-js'
import { Maximize2, Minimize2 } from 'lucide-solid'
import { focusMode, toggleFocusMode } from '../lib/layout-focus.js'
import { Button } from './ui/button.jsx'
import { t } from '../i18n/index.js'

export const FocusModeButton: Component = () => {
  const label = () => (focusMode() ? t('specDetail.exitFullscreen') : t('specDetail.fullscreen'))

  return (
    <Button
      variant="outline"
      size="sm"
      class="h-6 w-6 shrink-0 p-0"
      onClick={toggleFocusMode}
      title={label()}
      aria-label={label()}
      aria-pressed={focusMode()}
    >
      <Show when={focusMode()} fallback={<Maximize2 class="h-3 w-3" />}>
        <Minimize2 class="h-3 w-3" />
      </Show>
    </Button>
  )
}
