import { describe, expect, it } from 'vitest'
import {
  createHistoryLoadGate,
  planHistoryLoad,
  type HistoryLoadInput,
} from '../chat-history-load.js'

function input(over: Partial<HistoryLoadInput> = {}): HistoryLoadInput {
  return {
    sid: 'sid-b',
    displayedSid: 'sid-a',
    displayedSpecId: undefined,
    fresh: false,
    listPending: false,
    known: true,
    specId: undefined,
    running: false,
    ...over,
  }
}

describe('planHistoryLoad', () => {
  it('does nothing while the Untitled draft row is selected', () => {
    expect(planHistoryLoad(input({ sid: '' }))).toEqual({ action: 'idle' })
  })

  it('never reads the transcript of a locally created session on screen', () => {
    expect(
      planHistoryLoad(input({ displayedSid: 'sid-b', fresh: true, specId: 'spec-1' })),
    ).toEqual({ action: 'fresh' })
  })

  // Regression: `fresh` used to win outright, whatever was on screen. But
  // `parts` is one global list, not a per-session cache — switching away clears
  // it, and `fresh` only lifts when the first turn completes, so returning to a
  // still-running new session cleared the area a second time and then refused
  // to load it. Blank until the turn ended or the page was reloaded, with no
  // message request in the network tab to explain it.
  it('reads back a locally created session we have switched away from', () => {
    expect(planHistoryLoad(input({ fresh: true }))).toEqual({
      action: 'load',
      clear: true,
      specId: undefined,
    })
  })

  it('reads the whole spec row when returning to a locally created round', () => {
    expect(planHistoryLoad(input({ fresh: true, specId: 'spec-1', running: true }))).toEqual({
      action: 'load',
      clear: true,
      specId: 'spec-1',
    })
  })

  it('loads a plain chat and blanks the area when switching sessions', () => {
    expect(planHistoryLoad(input())).toEqual({ action: 'load', clear: true, specId: undefined })
  })

  it('reloads without blanking when the session on screen is the one being read', () => {
    expect(planHistoryLoad(input({ displayedSid: 'sid-b' }))).toEqual({
      action: 'load',
      clear: false,
      specId: undefined,
    })
  })

  it('reads the whole spec row, not the single session', () => {
    expect(planHistoryLoad(input({ specId: 'spec-1' }))).toEqual({
      action: 'load',
      clear: true,
      specId: 'spec-1',
    })
  })

  it('leaves a streaming turn alone rather than re-reading underneath it', () => {
    expect(
      planHistoryLoad(
        input({
          displayedSid: 'sid-b',
          displayedSpecId: 'spec-1',
          specId: 'spec-1',
          running: true,
        }),
      ),
    ).toEqual({ action: 'keep' })
  })

  // Regression: a new round's session (run / append / git-ops each create one)
  // is absent from the list until the refetch selectSession() fired lands. It
  // used to be read as a plain chat — which blanked the panel, showed only that
  // round, and pinned `displayedSid` so the 'keep' branch below then swallowed
  // the corrective reload, stranding the panel until the user switched rows.
  it('holds the current view while the list is behind on a just-created session', () => {
    expect(planHistoryLoad(input({ known: false, listPending: true }))).toEqual({ action: 'hold' })
  })

  it('holds even when the stale list makes the session look like a plain chat', () => {
    expect(
      planHistoryLoad(
        input({ known: false, listPending: true, specId: undefined, running: false }),
      ),
    ).toEqual({ action: 'hold' })
  })

  it('loads the whole spec row once the list catches up mid-round', () => {
    // The state one refetch later: the list now knows sid-b, and the round it
    // was created for is running. `displayedSid` is still the previous session
    // precisely because 'hold' declined to pin it.
    expect(planHistoryLoad(input({ known: true, specId: 'spec-1', running: true }))).toEqual({
      action: 'load',
      clear: true,
      specId: 'spec-1',
    })
  })

  // Regression: the panel used to hold ONLY when the list had already loaded,
  // so the ~1.1s window in which `GET /sessions` is still in flight (it merges
  // every adapter's transcript scan; the spec-session probe that triggers the
  // switch answers in ~1.5ms) fell through to a single-session load. That is the
  // same poisoning by a different door: it pinned `displayedSid`, and 'keep'
  // then stranded the panel on one round for the rest of the turn.
  it('holds while the very first list request is still in flight', () => {
    expect(planHistoryLoad(input({ known: false, listPending: true, displayedSid: '' }))).toEqual({
      action: 'hold',
    })
  })

  // ...but holding must be a wait, not a resting place: a session past
  // SESSION_LIST_LIMIT (or a failed list request) is never going to show up, and
  // hanging on it left the panel frozen on the previous row's history.
  it('falls back to a single-session load once the list settles without the session', () => {
    expect(planHistoryLoad(input({ known: false, listPending: false }))).toEqual({
      action: 'load',
      clear: true,
      specId: undefined,
    })
  })

  // Regression: that fallback is only safe because it stays correctable. The
  // guard compares scope as well as session, so a round loaded as a plain chat
  // is re-read as the whole spec row as soon as the list catches up — even
  // mid-turn, which is exactly when the old guard swallowed it.
  it('re-reads the spec row when the area holds a single session of it, mid-turn', () => {
    expect(
      planHistoryLoad(
        input({
          sid: 'sid-b',
          displayedSid: 'sid-b',
          displayedSpecId: undefined,
          specId: 'spec-1',
          running: true,
        }),
      ),
    ).toEqual({ action: 'load', clear: false, specId: 'spec-1' })
  })

  it('keeps a streaming turn whose spec row is already the content on screen', () => {
    expect(
      planHistoryLoad(
        input({
          displayedSid: 'sid-b',
          displayedSpecId: 'spec-1',
          specId: 'spec-1',
          running: true,
        }),
      ),
    ).toEqual({ action: 'keep' })
  })

  it('prefers the fresh branch over holding for a locally created session', () => {
    // A just-sent draft is also missing from the list, but it has an optimistic
    // user message on screen that must not be held hostage to a refetch.
    expect(
      planHistoryLoad(
        input({
          sid: 'sid-b',
          displayedSid: 'sid-b',
          fresh: true,
          known: false,
          listPending: true,
        }),
      ),
    ).toEqual({ action: 'fresh' })
  })
})

describe('createHistoryLoadGate', () => {
  // Regression (Debug 3): the history effect used to cancel its in-flight read
  // from `onCleanup`, which fires on EVERY re-run — including the ones that
  // decide to change nothing. A `clear: true` load blanked the area, a list
  // response re-ran the effect mid-read, the read was cancelled, and the plan
  // that followed was `keep`, which starts nothing. Blank for the rest of the
  // round, with no pending request to explain it.
  it('keeps a read alive across a re-run that starts no replacement', () => {
    const gate = createHistoryLoadGate()
    const isCurrent = gate.begin()
    // …effect re-runs and returns `keep` / `hold`: nothing takes the area over…
    expect(isCurrent()).toBe(true)
  })

  it('drops a read once a newer one claims the area', () => {
    const gate = createHistoryLoadGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })

  it('drops a read when the area is taken over without loading', () => {
    const gate = createHistoryLoadGate()
    const inFlight = gate.begin()
    // Project switch / "new session" / a draft's optimistic user message.
    gate.invalidate()
    expect(inFlight()).toBe(false)
  })

  it('lets a later read win after an invalidate', () => {
    const gate = createHistoryLoadGate()
    gate.begin()
    gate.invalidate()
    const next = gate.begin()
    expect(next()).toBe(true)
  })
})
