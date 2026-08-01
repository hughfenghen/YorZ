/**
 * Merge logic for the incrementally streamed command log.
 *
 * The detail page paints from a REST slice, then follows an SSE tail. Frames
 * can be missed (reconnect, a subscriber joining an already-running tail), so
 * every chunk carries the byte offset it starts at and we only append when it
 * continues exactly where we left off. A gap is not recoverable client-side —
 * the caller has to refetch.
 *
 * Kept as pure functions in `lib/` because that is the only layer covered by
 * unit tests; the page component just holds the state.
 */

export interface CommandOutputState {
  text: string
  /** Byte offset the next contiguous chunk must start at. */
  nextOffset: number
  /** The head of the log was dropped by the server's tail cap. */
  truncated: boolean
}

export interface OutputChunk {
  offset: number
  chunk: string
}

export interface OutputSlice {
  offset: number
  text: string
  size: number
  truncated: boolean
}

export interface AppendResult {
  state: CommandOutputState
  /** The chunk did not line up; the caller must refetch the whole slice. */
  needsRefetch: boolean
}

export function emptyOutputState(): CommandOutputState {
  return { text: '', nextOffset: 0, truncated: false }
}

/** Build state from a REST slice (first paint, or a refetch after a gap). */
export function stateFromSlice(slice: OutputSlice): CommandOutputState {
  return {
    text: slice.text,
    nextOffset: slice.offset + byteLength(slice.text),
    truncated: slice.truncated,
  }
}

export function appendChunk(state: CommandOutputState, chunk: OutputChunk): AppendResult {
  if (chunk.offset === state.nextOffset) {
    return {
      state: {
        text: state.text + chunk.chunk,
        nextOffset: state.nextOffset + byteLength(chunk.chunk),
        truncated: state.truncated,
      },
      needsRefetch: false,
    }
  }
  // Already-seen bytes (a duplicate frame after a reconnect) are dropped rather
  // than refetched: re-requesting would just replay the same content.
  if (chunk.offset + byteLength(chunk.chunk) <= state.nextOffset) {
    return { state, needsRefetch: false }
  }
  // Anything else is a hole (or an overlap we cannot splice) — resync.
  return { state, needsRefetch: true }
}

/** Cap the retained text so a long-running dev server cannot grow it forever. */
export function capText(state: CommandOutputState, maxChars: number): CommandOutputState {
  if (state.text.length <= maxChars) return state
  return {
    text: state.text.slice(state.text.length - maxChars),
    nextOffset: state.nextOffset,
    truncated: true,
  }
}

function byteLength(s: string): number {
  // The server counts bytes; JS string length counts UTF-16 code units. They
  // differ for any non-ASCII output, which a build tool will happily emit.
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length
  return s.length
}
