import { describe, expect, it } from 'vitest'
import { diffRevision, reconcileSelection, statusTone } from '@shared/lib/git-changes.js'
import type { GitChange } from '@shared/api/index.js'

const change = (path: string, index = ' ', worktree = 'M'): GitChange => ({
  path,
  index,
  worktree,
  status: `${index}${worktree}`.trim(),
})

describe('statusTone', () => {
  it('maps every known git status to a semantic token', () => {
    expect(statusTone('M')).toBe('text-warning')
    expect(statusTone('A')).toBe('text-success')
    expect(statusTone('D')).toBe('text-destructive')
    expect(statusTone('??')).toBe('text-info')
    expect(statusTone('R')).toBe('text-primary')
  })

  it('returns an empty class for an unknown status instead of undefined', () => {
    // The caller interpolates this straight into a class string; `undefined`
    // would render the literal word in the DOM.
    expect(statusTone('X')).toBe('')
    expect(statusTone('')).toBe('')
  })
})

describe('reconcileSelection', () => {
  const next = [change('a.ts'), change('b.ts')]

  it('keeps selections that still exist in the new list', () => {
    const result = reconcileSelection(['a.ts', 'b.ts'], null, next)
    expect([...result.selected].sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('drops a selection for a file that left the list', () => {
    // This is the commit case: the file was consumed and is gone, but the row
    // was still checked. Keeping it would send paths with nothing staged.
    const result = reconcileSelection(['a.ts', 'gone.ts'], null, next)
    expect([...result.selected]).toEqual(['a.ts'])
  })

  it('keeps the preview when its file survived', () => {
    expect(reconcileSelection([], 'b.ts', next).active).toBe('b.ts')
  })

  it('clears the preview when its file left the list', () => {
    expect(reconcileSelection([], 'gone.ts', next).active).toBeNull()
  })

  it('clears everything when the new list is empty', () => {
    const result = reconcileSelection(['a.ts'], 'a.ts', [])
    expect(result.selected.size).toBe(0)
    expect(result.active).toBeNull()
  })

  it('passes a null preview through untouched', () => {
    expect(reconcileSelection([], null, next).active).toBeNull()
  })

  it('does not mutate the caller-owned previous selection', () => {
    const prev = new Set(['a.ts', 'gone.ts'])
    reconcileSelection(prev, null, next)
    expect([...prev].sort()).toEqual(['a.ts', 'gone.ts'])
  })
})

describe('diffRevision', () => {
  it('concatenates index and worktree status', () => {
    expect(diffRevision(change('a.ts', 'M', ' '))).toBe('M ')
  })

  it('changes when the file moves between staged and unstaged', () => {
    // This difference is the whole point: it is what invalidates the cached
    // diff resource after a commit or a discard.
    expect(diffRevision(change('a.ts', ' ', 'M'))).not.toBe(diffRevision(change('a.ts', 'M', ' ')))
  })

  it('returns an empty marker for a path that is no longer in the list', () => {
    expect(diffRevision(undefined)).toBe('')
  })
})
