/**
 * What the Chat panel should do with the message area when the active session
 * changes.
 *
 * Split out of the effect in `ChatPanel.tsx` as a pure function because the
 * decision is genuinely order-sensitive and that ordering is where it went
 * wrong: `selectSession()` sets the active id synchronously but the session list
 * is a second, much slower request (it merges every adapter's transcript scan —
 * ~1.1s against ~1.5ms for the spec-session probe that triggers the switch), so
 * a session is routinely active long before the list can say which spec it
 * belongs to. Loading it as a plain chat in that window blanked the panel,
 * showed a single round, and pinned `displayedSid`, after which the running
 * guard swallowed the corrective reload. Keeping this pure is what lets that
 * sequence be asserted in a test.
 *
 * Two invariants come out of that:
 *
 * 1. Never write `displayedSid` from a guess. While the list still owes us an
 *    answer about `sid`, hold — do not clear, do not load.
 * 2. Remember the SCOPE that is on screen, not just the session. A load that
 *    was made under a guess (or under a list that truncated the session away)
 *    has to stay correctable, and the running guard must not mistake
 *    "same session" for "same content".
 */
export interface HistoryLoadInput {
  /** Active session id; empty while the Untitled draft row is selected. */
  sid: string
  /** Session currently rendered in the message area; empty when none is. */
  displayedSid: string
  /**
   * Spec whose aggregate transcript is on screen, or undefined when the area
   * holds a single session's history. This is what the rendered content
   * actually IS, as opposed to `specId` below, which is what it should be.
   */
  displayedSpecId?: string
  /**
   * Created locally by this tab, and its first turn has not completed yet.
   * NOT a promise that the transcript is unreadable — the agent appends to it
   * from the opening prompt onward — only that this tab's in-memory parts are
   * at least as complete as it. See the `fresh` branch below for why that
   * distinction decides whether reading is allowed.
   */
  fresh: boolean
  /**
   * A session-list request is in flight. Combined with `known` below this is
   * the "the list still owes us an answer" signal: once it settles, an unknown
   * session is genuinely unknown (truncated past the list limit, or the request
   * failed) and falls back to a single-session load rather than hanging.
   */
  listPending: boolean
  /** The list contains `sid`, so `specId` below reflects the truth. */
  known: boolean
  /** Spec of the active session's row; undefined for a plain chat. */
  specId?: string
  /** A turn is in flight on the active session (tracked for spec rows only). */
  running: boolean
}

export type HistoryLoadPlan =
  /** Nothing selected — leave the area alone. */
  | { action: 'idle' }
  /** Local draft already on screen: leave its in-memory parts alone. */
  | { action: 'fresh' }
  /** The list still owes an answer about this session; hold the current view. */
  | { action: 'hold' }
  /** A live turn owns the area and its content is already the right scope. */
  | { action: 'keep' }
  /** Read the transcript — the whole spec row when `specId` is set. */
  | { action: 'load'; clear: boolean; specId?: string }

export function planHistoryLoad(input: HistoryLoadInput): HistoryLoadPlan {
  const { sid, displayedSid, displayedSpecId, fresh, listPending, known, specId, running } = input
  if (!sid) return { action: 'idle' }
  const sameSession = displayedSid === sid
  // Invariant 3. `fresh` licenses skipping the read only while the in-memory
  // parts it protects are still the thing on screen. `parts` is one global
  // list, not a per-session cache, so switching away already cleared them —
  // and `fresh` cannot be shed until the first turn completes, so coming back
  // mid-run used to clear a second time and then refuse to load, leaving the
  // area blank until the turn ended or the page was reloaded.
  //
  // Reading here is never worse than that blank: the transcript is appended to
  // from the opening prompt onward, and a session with no file yet answers
  // `200 []` — exactly the state the old branch produced unconditionally.
  if (fresh && sameSession) return { action: 'fresh' }
  // Invariant 1. Must come before the running guard below: while the list is
  // behind, `specId` is not merely unknown but actively misleading, and acting
  // on it here is what poisons `displayedSid` for the rest of the round.
  if (!known && listPending) return { action: 'hold' }
  // Invariant 2. A guessed single-session load leaves `displayedSpecId`
  // undefined while `specId` is now known, so the scopes differ and the guard
  // below lets the correction through even mid-turn.
  const sameScope = displayedSpecId === specId
  if (running && sameSession && sameScope) return { action: 'keep' }
  // Only blank when switching away from another session: reloading the session
  // already on screen swaps content in on arrival, so it does not flash empty —
  // which is what keeps the mid-turn scope correction invisible to the user.
  return { action: 'load', clear: !sameSession, specId }
}
