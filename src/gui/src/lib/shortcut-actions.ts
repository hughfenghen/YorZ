import { createSignal, onCleanup } from 'solid-js'

const [projectConfigRequestTick, setProjectConfigRequestTick] = createSignal(0)
const [focusModeShortcutHandler, setFocusModeShortcutHandler] = createSignal<(() => void) | null>(
  null,
)
let focusModeShortcutRegistrationId = 0

export { focusModeShortcutHandler, projectConfigRequestTick }

export function requestProjectConfigOpen(): void {
  setProjectConfigRequestTick((n) => n + 1)
}

export function registerFocusModeShortcut(handler: () => void): void {
  const registrationId = ++focusModeShortcutRegistrationId
  setFocusModeShortcutHandler(() => handler)
  onCleanup(() => {
    if (focusModeShortcutRegistrationId === registrationId) setFocusModeShortcutHandler(null)
  })
}
