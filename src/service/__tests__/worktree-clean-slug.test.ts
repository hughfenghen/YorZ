import { describe, expect, it } from 'vitest'
import { cleanWorktreeSlug } from '../worktree-manager.js'

describe('cleanWorktreeSlug', () => {
  it('strips YYMMDD-type- prefix', () => {
    expect(cleanWorktreeSlug('260630-feat-task-node-dblclick-open-modal')).toBe(
      'task-node-dblclick-open-modal',
    )
  })

  it('strips fix type prefix', () => {
    expect(cleanWorktreeSlug('260701-fix-login-bug')).toBe('login-bug')
  })

  it('strips refct type prefix', () => {
    expect(cleanWorktreeSlug('260615-refct-api-layer')).toBe('api-layer')
  })

  it('strips source branch suffix', () => {
    expect(cleanWorktreeSlug('260630-feat-add-tooltip-main')).toBe('add-tooltip')
  })

  it('strips develop suffix', () => {
    expect(cleanWorktreeSlug('260630-feat-add-tooltip-develop')).toBe('add-tooltip')
  })

  it('returns input unchanged when no prefix/suffix to strip', () => {
    expect(cleanWorktreeSlug('task-node-dblclick-open-modal')).toBe('task-node-dblclick-open-modal')
  })

  it('does not strip when date prefix missing even if type present', () => {
    expect(cleanWorktreeSlug('feat-something')).toBe('feat-something')
  })

  it('handles empty string', () => {
    expect(cleanWorktreeSlug('')).toBe('')
  })

  it('strips both prefix and suffix together', () => {
    expect(cleanWorktreeSlug('260702-feat-wt-name-and-delete-confirm-main')).toBe(
      'wt-name-and-delete-confirm',
    )
  })
})
