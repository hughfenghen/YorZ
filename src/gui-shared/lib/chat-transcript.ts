import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js'
import { api } from '../api/index.js'
import { subscribeSession, type SessionEvent } from '../api/sse.js'
import {
  groupParts,
  messagesToParts,
  specMessagesToParts,
  type ChatBlock,
  type ChatPart,
  type ToolExpandState,
} from './chat-blocks.js'
import { createHistoryLoadGate, planHistoryLoad } from './chat-history-load.js'
import { samePartTail, transcriptCacheKey, type TranscriptCache } from './transcript-cache.js'

/** Deltas are batched at this cadence; sub-frame flushes only cost re-renders. */
export const STREAM_FLUSH_MS = 80
/** How long a draft's first send waits for the session topic's `ready`. */
export const SUBSCRIBE_READY_TIMEOUT_MS = 1500

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export interface ChatTranscriptOptions {
  projectId: Accessor<string>
  /** Active session id; `''` is the draft — created on the first send. */
  sessionId: Accessor<string>
  /** Spec of the active session's row; undefined for a plain chat. */
  specId: Accessor<string | undefined>
  /**
   * Whether a turn is in flight on the active session, as the HOST sees it.
   *
   * Deliberately an input, not hook state: on desktop the authority is the
   * session-list response (`runningSids` is rebuilt wholesale from every list
   * payload, which is what makes a dropped `running=false` self-heal), and the
   * hook must not fight that. The hook only reports transitions it observes on
   * the wire, through `onRunningChange`.
   */
  running: Accessor<boolean>
  /** A session-list request is in flight. Defaults to false (mobile has no list). */
  listPending?: Accessor<boolean>
  /** The list knows this session, so `specId` reflects the truth. Defaults to true. */
  known?: Accessor<boolean>
  /**
   * The active session id changed underneath us: a draft's first send created
   * one, or codex swapped in its own mid-turn. The host must make this id
   * active — the hook's `sessionId` source is expected to follow.
   */
  onSessionIdChange: (sid: string) => void
  /** A run-state transition observed on the wire; the host records it. */
  onRunningChange: (sid: string, running: boolean) => void
  /** The session list is now stale (a session appeared or changed id). */
  onSessionsChanged?: () => void
  /** A different conversation now owns the area — hosts re-arm auto-scroll. */
  onSubjectChange?: () => void
  /** `[Error] …` copy; each app injects its own i18n. */
  errorLabel: (message: string) => string
  /**
   * Transcripts already read in this tab, so re-entering a session can paint
   * before the network answers. Opt-in: omit it and every cache branch below is
   * dead code, which is how desktop keeps its exact previous behaviour.
   *
   * Mobile needs it because its detail view is unmounted on every navigation —
   * `parts` does not survive, and the two reads that must complete before
   * anything can be drawn (the session list, then the transcript) are both slow.
   * Desktop switches sessions inside one live instance and never pays that.
   */
  transcriptCache?: TranscriptCache
}

/** What `send()` did, so the host can decide what to do with its own draft state. */
export type SendOutcome =
  /** POSTed successfully — safe to clear attachments. */
  | 'sent'
  /** The session exists but the POST failed; the error is already on screen. */
  | 'failed'
  /** Could not even create the session — the host should restore the input. */
  | 'not-started'

export interface ChatTranscript {
  blocks: Accessor<ChatBlock[]>
  /** Pass-through of the host's run state, for callers that only hold the hook. */
  running: Accessor<boolean>
  /** A draft's create→subscribe→send handshake is in flight; blocks double-create. */
  starting: Accessor<boolean>
  /**
   * The message area is empty but still owes content: either the transcript read
   * is in flight, or the session list has not yet said which spec this session
   * belongs to (`hold`) so the read is not even allowed to start.
   *
   * Exists because "no blocks" alone cannot tell "still loading" from "genuinely
   * empty", and only this module can tell them apart — the host sees neither
   * `planHistoryLoad`'s action nor the read's lifetime. Optional to read: a host
   * that ignores it behaves exactly as before.
   */
  historyLoading: Accessor<boolean>
  toolExpand: ToolExpandState
  send: (prompt: string, draftId?: string) => Promise<SendOutcome>
  abort: () => Promise<void>
  /** Drop back to an empty draft (desktop's "new session" button). */
  reset: () => void
  /** The host learned from elsewhere (a list response) that a turn is persisted. */
  markPersisted: (sid: string) => void
  /**
   * Harder reset for when every session id we hold becomes meaningless — a
   * project switch. Also forgets `fresh` marks and pending `ready` deferreds,
   * which `reset()` deliberately keeps (a draft that is mid-flight in the same
   * project must still be able to resolve its handshake).
   */
  resetAll: () => void
}

/**
 * The message area's orchestration, shared by desktop's ChatPanel and mobile's
 * ChatDetail: history reads, the session-level SSE stream, the streaming delta
 * buffer, tool-block expansion, and send/abort.
 *
 * This is deliberately NOT a component — everything above the parts stream
 * (bubble markup, composer, panel chrome) differs too much between the two
 * clients to share, while everything below it is a set of invariants that were
 * each paid for once and must not be re-derived:
 *
 *   - codex swaps its session id mid-turn, and the new id inherits `fresh`;
 *   - the event stream has no replay buffer, so a draft's first POST must wait
 *     for `ready` (or time out) or the opening deltas are lost;
 *   - a read in flight is invalidated only by a genuine takeover, never by an
 *     incidental effect re-run (see `createHistoryLoadGate`);
 *   - tool expansion state must outlive the ~12×/s block rebuild during a run.
 */
export function createChatTranscript(o: ChatTranscriptOptions): ChatTranscript {
  /**
   * The structured part stream — the single source of truth for the message
   * area. Both the transcript API and the live SSE stream translate into these,
   * so a reloaded session renders identically to one you watched stream in.
   */
  const [parts, setParts] = createSignal<ChatPart[]>([])
  const blocks = createMemo(() => groupParts(parts()))
  const [starting, setStarting] = createSignal(false)
  /** See `ChatTranscript.historyLoading`. Written only by the history effect and the resets. */
  const [historyLoading, setHistoryLoading] = createSignal(false)

  /**
   * Which tool collapsibles the reader has opened, keyed by `ToolsSegment.id` /
   * `toolTextKey`. Owned here rather than by the tool component because that
   * component does not survive a stream tick: `groupParts` rebuilds every block
   * object, so the list remounts the whole tool tree during a run and an
   * instance-local signal went back to `false` each time.
   *
   * Deliberately NOT cleared when the transcript is re-read for the session
   * already on screen — that path fires precisely when a running spec's round
   * settles. Only a genuine change of subject clears it.
   */
  const [expandedKeys, setExpandedKeys] = createSignal<Record<string, boolean>>({})
  const toolExpand: ToolExpandState = {
    isExpanded: (key) => expandedKeys()[key] === true,
    set: (key, value) =>
      setExpandedKeys((prev) => (prev[key] === value ? prev : { ...prev, [key]: value })),
  }
  function resetExpanded(): void {
    setExpandedKeys((prev) => (Object.keys(prev).length === 0 ? prev : {}))
  }

  /**
   * Sessions created locally in this tab that have no transcript on disk yet:
   * their parts live only in memory (optimistic user message + live deltas), so
   * the history effect must not clear them and refetch an empty transcript. An
   * id leaves the set once its first turn completes and gets persisted.
   */
  const freshSids = new Set<string>()
  const [freshRevision, setFreshRevision] = createSignal(0)
  let displayedSid = ''
  /**
   * Spec whose aggregate transcript the area currently holds, or undefined when
   * it holds a single session. Tracked alongside `displayedSid` because "same
   * session" alone cannot tell a spec row's full history apart from the single
   * round loaded before the list knew about the spec.
   */
  let displayedSpecId: string | undefined
  /**
   * Session whose CACHED transcript is currently standing in on screen, waiting
   * for the authoritative read to confirm or replace it.
   *
   * Deliberately separate from `displayedSid`: an optimistic paint is pixels
   * only, never bookkeeping. Writing `displayedSid` from it would break the
   * invariant that the displayed scope is never set from a guess, and the
   * correcting load would then be swallowed. What this variable does buy is the
   * right to skip the blanking `resetParts()` on a `clear` load — clearing the
   * cached copy of the very session we are about to load hands the blank screen
   * straight back.
   */
  let paintedFromCache = ''
  const historyGate = createHistoryLoadGate()

  /**
   * Draw the cached transcript for `sid`, if there is one. Returns whether the
   * area now holds content, which is also the answer to "may the spinner stay
   * off while the read is in flight".
   *
   * The cached scope is not required to match the one about to be read: during
   * `hold` the scope is not even known yet, and a single-session copy of a spec
   * row is a subset of the right answer — visibly better than blank, and the
   * read that follows always gets the last word.
   */
  function paintCached(pid: string, sid: string): boolean {
    if (paintedFromCache === sid) return true
    const cached = o.transcriptCache?.get(transcriptCacheKey(pid, sid))
    if (!cached || cached.parts.length === 0) return false
    resetParts(cached.parts)
    paintedFromCache = sid
    return true
  }
  /** sid → deferred resolved by the session topic's `ready` event. */
  const readyWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>()

  function waitForSubscription(sid: string): Promise<void> {
    let entry = readyWaiters.get(sid)
    if (!entry) {
      let resolve: () => void = () => {}
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      entry = { promise, resolve }
      readyWaiters.set(sid, entry)
    }
    return entry.promise
  }

  function markSubscribed(sid: string): void {
    void waitForSubscription(sid)
    readyWaiters.get(sid)?.resolve()
  }

  /**
   * This session's first turn is on disk now, so its in-memory parts stop being
   * the more complete copy and the history effect may read the transcript again.
   *
   * Only bumps the revision for the session on screen: the bump exists purely to
   * re-run that effect, and for any other id the plan it would recompute is
   * identical. Called both from `turn-completed` and from the host, whose
   * session-list response is the other place a persisted turn shows up.
   */
  function markFreshPersisted(sid: string): void {
    if (!freshSids.delete(sid)) return
    if (sid === o.sessionId()) setFreshRevision((v) => v + 1)
  }

  // --- streaming delta buffer -------------------------------------------------
  /** Deltas seen since the last flush. Never read outside flushDeltas(). */
  let pendingDelta = ''
  let flushTimer: number | null = null

  function withAssistantText(prev: ChatPart[], text: string): ChatPart[] {
    const last = prev[prev.length - 1]
    if (last && last.kind === 'text' && last.role === 'assistant') {
      return [...prev.slice(0, -1), { ...last, text: last.text + text }]
    }
    return [...prev, { kind: 'text', role: 'assistant', text }]
  }

  function flushDeltas(): void {
    if (flushTimer != null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    const delta = pendingDelta
    pendingDelta = ''
    if (!delta) return
    setParts((prev) => withAssistantText(prev, delta))
  }

  /** Buffered append for high-frequency stream deltas. */
  function appendAssistantDelta(delta: string): void {
    pendingDelta += delta
    if (flushTimer != null) return
    flushTimer = window.setTimeout(flushDeltas, STREAM_FLUSH_MS)
  }

  /**
   * Immediate append for one-off assistant text (errors). Flushing first is what
   * preserves arrival order — buffered deltas must land before this text does.
   */
  function appendAssistant(text: string): void {
    flushDeltas()
    setParts((prev) => withAssistantText(prev, text))
  }

  /** Append a non-text part (or a user message), after draining the buffer. */
  function pushPart(part: ChatPart): void {
    flushDeltas()
    setParts((prev) => [...prev, part])
  }

  /** Drop everything on screen, buffer included — a stale delta must not resurface. */
  function resetParts(next: ChatPart[] = []): void {
    if (flushTimer != null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pendingDelta = ''
    setParts((prev) => (next.length === 0 && prev.length === 0 ? prev : next))
  }

  function appendError(message: string): void {
    appendAssistant(`\n${o.errorLabel(message)}\n`)
  }

  // --- session selection → load history ---------------------------------------
  createEffect(() => {
    const pid = o.projectId()
    const sid = o.sessionId()
    const specId = o.specId()
    // Tracked for spec rows only: a spec's row spans several sessions, so when
    // the current round settles the transcript is re-read to fold that round in
    // (with its divider). Plain chats keep the old load-on-select behaviour.
    const running = specId ? o.running() : false
    const plan = planHistoryLoad({
      sid,
      displayedSid,
      displayedSpecId,
      fresh: freshSids.has(sid),
      listPending: o.listPending?.() ?? false,
      known: o.known?.() ?? true,
      specId,
      running,
    })
    freshRevision()
    // `hold` is the one early return that still owes content: the list has not
    // said which spec this session belongs to, so the read may not start yet and
    // the area stays (correctly) blank until it settles. Reporting "not loading"
    // here is what made the empty state flash before the transcript arrived.
    // No project: nothing can be read, so nothing is pending either.
    if (!pid) {
      setHistoryLoading(false)
      return
    }
    if (plan.action === 'hold') {
      // The one place the cache pays off twice: this wait is the session-list
      // request, which is the slower of the two and produces no content at all.
      setHistoryLoading(!paintCached(pid, sid))
      return
    }
    // `idle` (draft) and `keep` (a live turn already owns the right content) are
    // steady states: whatever is on screen is what there is.
    if (plan.action === 'idle' || plan.action === 'keep') {
      setHistoryLoading(false)
      return
    }
    // A locally-created session that is still the content on screen: `parts`
    // already holds the optimistic user message plus whatever has streamed in,
    // and it is strictly ahead of the transcript.
    if (plan.action === 'fresh') {
      setHistoryLoading(false)
      o.onSubjectChange?.()
      return
    }

    o.onSubjectChange?.()
    // `plan.clear` means the area is about to hold a *different* conversation,
    // so the open/closed marks from the old one are meaningless. The re-read
    // below (same session, fresher transcript) deliberately keeps them.
    //
    // Unless what is on screen is this same session's cached transcript: that is
    // not the old conversation, it is an early draw of this one, so blanking it
    // would undo the whole point and its expand marks are still meaningful.
    if (plan.clear && paintedFromCache !== sid) {
      resetParts()
      resetExpanded()
    }
    displayedSid = sid
    displayedSpecId = plan.specId
    const isCurrent = historyGate.begin()
    setHistoryLoading(!paintCached(pid, sid))
    // Flatten message → parts: tool-result keeps its payload instead of being
    // dropped, so the transcript and the live stream agree. A spec row reads
    // every session it owns, dividers included.
    const load = plan.specId
      ? api.getSpecMessages(pid, plan.specId).then(specMessagesToParts)
      : api.getSessionMessages(pid, sid).then(messagesToParts)
    void load
      .then((next) => {
        // Not `onCleanup`: the effect re-runs for reasons that have nothing to
        // do with the content, and cancelling there dropped this transcript on
        // the floor after `clear` had already blanked the area.
        if (!isCurrent()) return
        paintedFromCache = ''
        // Same tail at the same length means this is what is already drawn (the
        // cached copy was current). Swapping it in anyway would rebuild every
        // block object and remount the message tree for no change at all.
        if (!samePartTail(parts(), next)) resetParts(next)
        setHistoryLoading(false)
        // An empty transcript is not worth a slot: a hit on it would render the
        // "no messages yet" state, which is exactly the flash to avoid.
        if (next.length > 0) {
          o.transcriptCache?.set(transcriptCacheKey(pid, sid), {
            specId: plan.specId,
            parts: next,
          })
        }
      })
      .catch(() => {
        // Same gate as the success path: a superseded read must not clear the
        // flag out from under the load that took the area over.
        if (isCurrent()) setHistoryLoading(false)
      })
  })

  // --- session selection → subscribe to the live stream ------------------------
  createEffect(() => {
    const pid = o.projectId()
    const sid = o.sessionId()
    if (!pid || !sid) return
    const sub = subscribeSession(pid, sid, {
      onReady: () => markSubscribed(sid),
      onEvent: (ev: SessionEvent) => {
        if (ev.type === 'text') appendAssistantDelta(ev.delta)
        else if (ev.type === 'tool-use') {
          pushPart({ kind: 'tool', name: ev.name, input: ev.input })
        } else if (ev.type === 'tool-result') {
          pushPart({ kind: 'tool', result: ev.text })
        } else if (ev.type === 'turn-completed') {
          // The turn is persisted now — a later re-select should read the
          // transcript rather than trust this tab's in-memory parts. Drain the
          // buffer first, or the tail of the last delta is lost.
          flushDeltas()
          markFreshPersisted(sid)
          o.onRunningChange(sid, false)
        } else if (ev.type === 'error') {
          appendError(ev.message)
          o.onRunningChange(sid, false)
        } else if (ev.type === 'session-started' && ev.sessionId !== sid) {
          // codex swaps in its own id mid-turn. The new id has no transcript
          // either, so inherit `fresh` — otherwise re-subscribing under the new
          // id would clear the deltas already on screen.
          if (freshSids.has(sid)) freshSids.add(ev.sessionId)
          if (displayedSid === sid) displayedSid = ev.sessionId
          o.onRunningChange(sid, false)
          o.onRunningChange(ev.sessionId, true)
          // The list must already be in flight when the new id goes live.
          o.onSessionsChanged?.()
          o.onSessionIdChange(ev.sessionId)
        }
        // `compact` carries only metrics; nothing to render.
      },
    })
    onCleanup(() => {
      readyWaiters.delete(sid)
      sub()
    })
  })

  onCleanup(() => {
    if (flushTimer != null) clearTimeout(flushTimer)
    // The host is gone; a read still in flight must not write to it.
    historyGate.invalidate()
    // Hand the area's final state to the cache before it is dropped. This copy
    // is strictly better than the one the read stored: it also contains whatever
    // streamed in afterwards, so coming back to a session that just finished a
    // turn shows that turn immediately instead of the state before it.
    const pid = o.projectId()
    const current = parts()
    if (pid && displayedSid && current.length > 0) {
      o.transcriptCache?.set(transcriptCacheKey(pid, displayedSid), {
        specId: displayedSpecId,
        parts: current,
      })
    }
  })

  /**
   * Drop back to an empty draft. The session is created by the first send —
   * this is what kills the empty-shell sessions the server had to filter out.
   */
  function reset(): void {
    resetParts()
    resetExpanded()
    historyGate.invalidate()
    // The read this would have been waiting on is now disowned; leaving the flag
    // set would pin the fresh draft on a spinner that nothing can ever clear.
    setHistoryLoading(false)
    displayedSid = ''
    displayedSpecId = undefined
    paintedFromCache = ''
    o.onSubjectChange?.()
  }

  function resetAll(): void {
    reset()
    setStarting(false)
    freshSids.clear()
    setFreshRevision((v) => v + 1)
    readyWaiters.clear()
  }

  async function send(prompt: string, draftId?: string): Promise<SendOutcome> {
    const pid = o.projectId()
    const sid = o.sessionId()
    if (!pid || !prompt || starting() || o.running()) return 'failed'
    o.onSubjectChange?.()
    if (!sid) return sendFromDraft(pid, prompt, draftId)
    pushPart({ kind: 'text', role: 'user', text: prompt })
    o.onRunningChange(sid, true)
    try {
      await api.sendSessionMessage(pid, sid, prompt, draftId)
      return 'sent'
    } catch (err) {
      appendError((err as Error).message)
      o.onRunningChange(sid, false)
      return 'failed'
    }
  }

  /**
   * Draft → live session, in one go. Create and POST race the session
   * subscription: the event stream has no replay buffer, so any delta emitted
   * before our topic attaches is gone. Gate the POST on the server's `ready`
   * event, with a timeout so a lost `ready` degrades gracefully.
   */
  async function sendFromDraft(
    pid: string,
    prompt: string,
    draftId?: string,
  ): Promise<SendOutcome> {
    setStarting(true)
    try {
      let sid: string
      try {
        sid = (await api.createSession(pid, {})).sessionId
      } catch (err) {
        appendError((err as Error).message)
        return 'not-started'
      }
      freshSids.add(sid)
      // Register the deferred BEFORE the selection effect subscribes, so the
      // `ready` event cannot land between subscribe and await.
      const ready = waitForSubscription(sid)
      resetParts([{ kind: 'text', role: 'user', text: prompt }])
      resetExpanded()
      historyGate.invalidate()
      displayedSid = sid
      displayedSpecId = undefined
      paintedFromCache = ''
      o.onRunningChange(sid, true)
      o.onSessionIdChange(sid)
      await Promise.race([ready, delay(SUBSCRIBE_READY_TIMEOUT_MS)])
      let outcome: SendOutcome
      try {
        await api.sendSessionMessage(pid, sid, prompt, draftId)
        outcome = 'sent'
      } catch (err) {
        appendError((err as Error).message)
        o.onRunningChange(sid, false)
        outcome = 'failed'
      }
      o.onSessionsChanged?.()
      return outcome
    } finally {
      setStarting(false)
    }
  }

  async function abort(): Promise<void> {
    const pid = o.projectId()
    const sid = o.sessionId()
    if (!pid || !sid) return
    await api.abortSession(pid, sid).catch(() => {})
    o.onRunningChange(sid, false)
  }

  return {
    blocks,
    running: o.running,
    starting,
    historyLoading,
    toolExpand,
    send,
    abort,
    reset,
    markPersisted: markFreshPersisted,
    resetAll,
  }
}
