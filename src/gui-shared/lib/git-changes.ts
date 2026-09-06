/**
 * Working-tree change bookkeeping shared by the desktop `GitPanel` and the
 * mobile Git page.
 *
 * Both shells keep the same three invariants around a live, server-pushed file
 * list: the status glyph must use a semantic colour token (raw palette classes
 * are near-unreadable in dark mode), a refreshed list must drop any selection
 * or preview it invalidated, and the diff preview must be keyed by a revision
 * that changes when the file's staged/worktree state does — that key is what
 * makes a commit or discard invalidate the diff being shown.
 *
 * Pure functions, no solid import: this is the layer unit tests cover.
 */

import type { GitChange } from '../api/index.js'

/** Semantic colour token for a git status glyph (`M`, `A`, `D`, `??`, `R`). */
const STATUS_TONE: Record<string, string> = {
  M: 'text-warning',
  A: 'text-success',
  D: 'text-destructive',
  '??': 'text-info',
  R: 'text-primary',
}

export function statusTone(status: string): string {
  return STATUS_TONE[status] ?? ''
}

export interface SelectionState {
  /** Paths still selected after reconciliation. */
  selected: Set<string>
  /** The previewed path, or null when it no longer exists in the new list. */
  active: string | null
}

/**
 * Adopt a new file list and drop any selection / preview it invalidated.
 *
 * A committed or discarded file disappears from the list while still checked;
 * leaving it selected would send paths with nothing staged on the next action
 * and git would exit 1, surfacing as an opaque 400.
 */
export function reconcileSelection(
  prevSelected: Iterable<string>,
  prevActive: string | null,
  next: readonly GitChange[],
): SelectionState {
  const validPaths = new Set(next.map((c) => c.path))
  const selected = new Set<string>()
  for (const path of prevSelected) if (validPaths.has(path)) selected.add(path)
  return {
    selected,
    active: prevActive && validPaths.has(prevActive) ? prevActive : null,
  }
}

/**
 * Revision marker for a file's diff-resource key.
 *
 * Index + worktree status is what changes when the file is committed, staged or
 * discarded, so folding it into the resource key re-fetches the preview exactly
 * when the patch it shows has been rewritten. An unknown path yields an empty
 * marker, which still differs from any real state.
 */
export function diffRevision(change: GitChange | undefined): string {
  return `${change?.index ?? ''}${change?.worktree ?? ''}`
}
