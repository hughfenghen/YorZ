import type { ChatPart } from './chat-blocks.js'

/**
 * An in-memory LRU of session transcripts, plus the "did the tail change?"
 * comparison that decides whether an arriving read is allowed to replace what
 * is already on screen.
 *
 * Why this exists: entering a session detail view costs two serial round trips
 * before anything can be drawn — the session list (which alone says whether the
 * session belongs to a spec, and therefore which transcript endpoint to read)
 * and then the transcript itself. Neither is fast, and on mobile the whole view
 * is unmounted on every navigation, so the content you looked at a second ago
 * is gone. Holding the last few transcripts lets the view paint immediately and
 * let the authoritative read correct it, exactly like the session list already
 * does from localStorage.
 *
 * Deliberately free of `window` and `solid-js`: vitest runs in a node
 * environment over `src/**\/*.test.ts` only, so the LRU and the comparison are
 * only testable while they stay pure. The Solid wiring lives in
 * `chat-transcript.ts`, the singleton in the app that opts in.
 */

/** Default capacity — how many sessions' transcripts stay resident. */
export const TRANSCRIPT_CACHE_CAPACITY = 20

/** NUL cannot appear in a project or session id, so keys cannot collide. */
const KEY_SEPARATOR = '\u0000'

export interface TranscriptCacheEntry {
  /**
   * The scope this content was read under: a spec's aggregate transcript when
   * set, a single session's when undefined.
   *
   * Kept alongside the parts rather than folded into the key because a session
   * should only ever hold ONE cached copy. Keying by scope would store both
   * shapes for the same session — halving the useful capacity while guaranteeing
   * one of the two is the wrong answer. Remembering the scope instead lets the
   * stale copy be painted first and then corrected once the truth arrives.
   */
  specId?: string
  parts: ChatPart[]
}

export interface TranscriptCache {
  get(key: string): TranscriptCacheEntry | undefined
  set(key: string, entry: TranscriptCacheEntry): void
  clear(): void
  readonly size: number
}

export function transcriptCacheKey(projectId: string, sessionId: string): string {
  return `${projectId}${KEY_SEPARATOR}${sessionId}`
}

/**
 * LRU over `Map`'s insertion order: re-inserting a key moves it to the back, so
 * `keys().next()` is always the least recently used one. Entries hold the very
 * same `ChatPart` objects that were rendered — nothing is copied, so the cost of
 * a hit is only that those objects outlive the view that drew them.
 */
export function createTranscriptCache(
  capacity: number = TRANSCRIPT_CACHE_CAPACITY,
): TranscriptCache {
  const entries = new Map<string, TranscriptCacheEntry>()
  const max = Math.max(1, Math.floor(capacity))

  function touch(key: string, entry: TranscriptCacheEntry): void {
    entries.delete(key)
    entries.set(key, entry)
  }

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      touch(key, entry)
      return entry
    },
    set(key, entry) {
      touch(key, entry)
      while (entries.size > max) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}

/** Field-wise equality of one part; `input` is deliberately excluded (see below). */
function samePart(a: ChatPart, b: ChatPart): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'text' && b.kind === 'text') return a.role === b.role && a.text === b.text
  // A tool call's `input` is delivered whole and never grows, so at the same
  // index with the same name and result it is the same call. Comparing it would
  // mean serialising a payload that is routinely megabytes (a file write) to
  // learn nothing.
  if (a.kind === 'tool' && b.kind === 'tool') return a.name === b.name && a.result === b.result
  if (a.kind === 'context' && b.kind === 'context')
    return a.contextKind === b.contextKind && a.text === b.text
  if (a.kind === 'divider' && b.kind === 'divider')
    return a.sessionId === b.sessionId && a.startedAt === b.startedAt
  return false
}

/**
 * Whether two part streams end the same way — the signal for "the transcript
 * that just arrived is the one already on screen, so do not swap it in".
 *
 * Length plus the last part is enough because the stream only ever grows at the
 * tail: `withAssistantText` rewrites the final text part, `pushPart` appends,
 * and nothing edits the middle. That leaves exactly one way to be equal in
 * length yet different — the cached copy caught the last message mid-stream —
 * and comparing the tail is precisely what catches it.
 *
 * Skipping an identical replacement is not a micro-optimisation: `resetParts`
 * hands out a new array, `groupParts` then rebuilds every block object, and the
 * message list remounts its whole tree. Doing that for content that did not
 * change is a visible flash.
 */
export function samePartTail(a: ChatPart[], b: ChatPart[]): boolean {
  if (a.length !== b.length) return false
  if (a.length === 0) return true
  return samePart(a[a.length - 1]!, b[b.length - 1]!)
}
