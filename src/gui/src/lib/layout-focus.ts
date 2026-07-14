import { createSignal } from 'solid-js'

/**
 * Transient "give the page the whole window" override.
 *
 * A page (today: SpecDetail, whose confirm panel + markdown column need the
 * room) can ask the chrome — projects sidebar and chat panel — to collapse.
 * Deliberately module-scoped signal rather than persisted state: panels keep
 * their OWN localStorage collapse flags untouched, so leaving focus mode
 * restores exactly the layout the user had before, and a reload never strands
 * them in a collapsed chrome they never chose.
 *
 * Same pattern as `chat-session-request.ts`: a module signal is the established
 * way for a page to talk to the shell without threading props through AppShell.
 */
const [focusMode, setFocusMode] = createSignal(false)

export { focusMode }

export function toggleFocusMode(): void {
  setFocusMode((on) => !on)
}

export function exitFocusMode(): void {
  setFocusMode(false)
}
