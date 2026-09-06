/**
 * Live view of a single command run — the record, its streamed log, and the
 * stop action — shared by the desktop run-detail page and the mobile one.
 *
 * The delicate part is not the rendering but the merge: the page paints from a
 * REST slice, then follows an SSE tail whose frames can be missed (reconnect, a
 * subscriber attaching to an already-running tail). `command-output.ts` decides
 * whether a chunk appends or forces a resync; this hook is the solid-signal
 * orchestration around it — the 80ms write batching, the in-flight refetch
 * latch, the per-second clock the duration readout needs, and the subscription
 * lifecycle. Both shells need all of it, and a second copy would mean two
 * places for an off-by-one byte offset to hide.
 *
 * The host keeps the DOM: the scroll element, the "am I parked at the bottom"
 * threshold (mobile's inertial scrolling wants a different tolerance), the i18n
 * strings, and the markup. This hook only says *when* a repaint happened.
 */

import { createEffect, createResource, createSignal, onCleanup, type Accessor } from 'solid-js'
import { api, type CommandRun } from '../api/index.js'
import { subscribeCommandOutput } from '../api/sse.js'
import {
  appendChunk,
  capText,
  emptyOutputState,
  stateFromSlice,
  type CommandOutputState,
} from './command-output.js'

/** Batch high-frequency deltas into one DOM write, as ChatPanel does. */
export const OUTPUT_FLUSH_MS = 80
/** Retained characters; a long-running dev server would otherwise grow forever. */
export const MAX_OUTPUT_CHARS = 400_000

export interface CommandRunViewOptions {
  projectId: Accessor<string | undefined>
  runId: Accessor<string | undefined>
  /**
   * A batch of tail output was just written to `text()`. Hosts follow the tail
   * here — but only if the user is still parked at the bottom.
   */
  onFlush?: () => void
  /**
   * The buffer was repainted wholesale (first paint or a post-gap resync).
   * There is no scroll position worth preserving; hosts jump to the bottom.
   */
  onReset?: () => void
}

/** Outcome of `stop()`; the host owns the toast, so the hook returns not throws. */
export interface StopResult {
  ok: boolean
  error?: string
}

export interface CommandRunView {
  run: Accessor<CommandRun | null | undefined>
  text: Accessor<string>
  /** The head of the log was dropped — by the server's tail cap or ours. */
  truncated: Accessor<boolean>
  loadError: Accessor<string | null>
  stopping: Accessor<boolean>
  /** Seconds-resolution heartbeat, so the duration readout ticks. */
  now: Accessor<number>
  reload: () => Promise<void>
  stop: () => Promise<StopResult>
}

export function createCommandRunView(options: CommandRunViewOptions): CommandRunView {
  const [run, { mutate: mutateRun }] = createResource<
    CommandRun | null,
    [string | undefined, string | undefined]
  >(
    () => [options.projectId(), options.runId()] as [string | undefined, string | undefined],
    async ([pid, runId]) => (pid && runId ? api.getCommandRun(pid, runId) : null),
  )

  const [output, setOutput] = createSignal<CommandOutputState>(emptyOutputState())
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [stopping, setStopping] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())

  let pending: CommandOutputState | null = null
  let flushTimer: number | null = null
  let refetching = false

  const timer = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(timer))

  onCleanup(() => {
    if (flushTimer !== null) window.clearTimeout(flushTimer)
  })

  function scheduleFlush(next: CommandOutputState): void {
    pending = capText(next, MAX_OUTPUT_CHARS)
    if (flushTimer !== null) return
    flushTimer = window.setTimeout(() => {
      flushTimer = null
      if (!pending) return
      setOutput(pending)
      pending = null
      options.onFlush?.()
    }, OUTPUT_FLUSH_MS)
  }

  /** Full resync: used for the first paint and whenever a chunk lands out of order. */
  async function reload(): Promise<void> {
    const pid = options.projectId()
    const runId = options.runId()
    if (!pid || !runId || refetching) return
    refetching = true
    try {
      const slice = await api.readCommandOutput(pid, runId)
      const next = capText(stateFromSlice(slice), MAX_OUTPUT_CHARS)
      pending = null
      setOutput(next)
      setLoadError(null)
      options.onReset?.()
    } catch (err) {
      setLoadError((err as Error).message)
    } finally {
      refetching = false
    }
  }

  createEffect(() => {
    const pid = options.projectId()
    const runId = options.runId()
    if (!pid || !runId) return
    setOutput(emptyOutputState())
    void reload()
    const unsub = subscribeCommandOutput(pid, runId, {
      onOutput: (chunk) => {
        const base = pending ?? output()
        const result = appendChunk(base, chunk)
        // A gap means frames were missed (reconnect, or the tail was already
        // running when we attached) — the byte stream cannot be spliced, so
        // re-read the whole slice instead of rendering corrupted output.
        if (result.needsRefetch) void reload()
        else scheduleFlush(result.state)
      },
      onRun: (next) => mutateRun(next),
      onError: (message) => setLoadError(message),
    })
    onCleanup(unsub)
  })

  async function stop(): Promise<StopResult> {
    const pid = options.projectId()
    const current = run()
    if (!pid || !current) return { ok: false }
    setStopping(true)
    try {
      // Stop deliberately keeps the record and its log: the point of this page
      // is to read the output after the process is gone.
      const res = await api.stopCommandRun(pid, current.runId)
      mutateRun(res.run)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    } finally {
      setStopping(false)
    }
  }

  return {
    run,
    text: () => output().text,
    truncated: () => output().truncated,
    loadError,
    stopping,
    now,
    reload,
    stop,
  }
}
