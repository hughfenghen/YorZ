import { createEffect, createSignal, onCleanup } from 'solid-js'

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

/**
 * Focus mode belongs to the GROUP of pages that opt in (SpecList / SpecDetail /
 * SpecReview / SpecDebug), not to any single one: they share the same main area,
 * so navigating between them must leave the chrome exactly as the user set it.
 * Pages that never call `useFocusModePage` (NewSpec, CommandRunDetail, …) render
 * no exit affordance, so leaving the group still has to restore the chrome —
 * which is why this is a refcount and not just "the last page wins".
 *
 * The zero-check is deferred by a microtask because a route swap disposes the
 * old page and builds the new one inside the same tick, in an order the router
 * owns: the count legitimately dips to 0 mid-swap. Reading it after the tick
 * settles sees only the real outcome, so an A→B handoff never flickers the
 * chrome while a genuine exit still fires.
 */
let focusPages = 0
let zeroCheckQueued = false

function releaseFocusPage(): void {
  focusPages -= 1
  if (zeroCheckQueued) return
  zeroCheckQueued = true
  queueMicrotask(() => {
    zeroCheckQueued = false
    if (focusPages <= 0) setFocusMode(false)
  })
}

export function useFocusModePage(isEscapeBlocked?: () => boolean): void {
  focusPages += 1
  onCleanup(releaseFocusPage)

  createEffect(() => {
    if (!focusMode()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isEscapeBlocked?.()) return
      exitFocusMode()
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })
}
