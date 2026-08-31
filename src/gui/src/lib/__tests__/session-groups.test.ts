import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '../api.js'
import { findGroupBySession, groupSessions } from '../session-groups.js'

function session(over: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    title: over.id,
    kind: 'claude',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

const idle = () => false

describe('groupSessions', () => {
  it('folds every session of one spec into a single row', () => {
    const groups = groupSessions(
      [
        session({ id: 's3', specId: 'spec-a', createdAt: 3, updatedAt: 30 }),
        session({ id: 's1', specId: 'spec-a', createdAt: 1, updatedAt: 10 }),
        session({ id: 's2', specId: 'spec-a', createdAt: 2, updatedAt: 20 }),
      ],
      idle,
    )

    expect(groups).toHaveLength(1)
    // Members are ordered by when the round happened, not by recency: the
    // aggregated transcript is stitched in this order.
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(groups[0]!.key).toBe('spec-a')
    expect(groups[0]!.latest.id).toBe('s3')
    expect(groups[0]!.updatedAt).toBe(30)
  })

  it('takes the row title and time from the most recent round, whatever the input order', () => {
    const groups = groupSessions(
      [
        session({ id: 's1', specId: 'spec-a', createdAt: 1, updatedAt: 99 }),
        session({ id: 's2', specId: 'spec-a', createdAt: 2, updatedAt: 5 }),
      ],
      idle,
    )

    expect(groups[0]!.latest.id).toBe('s1')
    expect(groups[0]!.updatedAt).toBe(99)
  })

  it('keeps sessions without a spec as their own rows', () => {
    const groups = groupSessions(
      [
        session({ id: 'chat-1' }),
        session({ id: 's1', specId: 'spec-a' }),
        session({ id: 'chat-2' }),
      ],
      idle,
    )

    expect(groups.map((g) => g.key)).toEqual(['chat-1', 'spec-a', 'chat-2'])
    expect(groups.every((g) => g.sessions.length === 1)).toBe(true)
  })

  it('preserves the incoming order of rows (the server sorts running first)', () => {
    const groups = groupSessions(
      [
        session({ id: 's1', specId: 'spec-a', updatedAt: 1 }),
        session({ id: 'chat-1', updatedAt: 100 }),
        session({ id: 's2', specId: 'spec-a', updatedAt: 2 }),
      ],
      idle,
    )

    expect(groups.map((g) => g.key)).toEqual(['spec-a', 'chat-1'])
  })

  it('marks a row running when ANY of its rounds is running', () => {
    const groups = groupSessions(
      [
        session({ id: 's1', specId: 'spec-a', createdAt: 1 }),
        session({ id: 's2', specId: 'spec-a', createdAt: 2 }),
        session({ id: 'chat-1' }),
      ],
      // The running round is NOT the most recent one — a spinner keyed off
      // `latest` alone would miss it.
      (sid) => sid === 's1',
    )

    expect(groups[0]!.running).toBe(true)
    expect(groups[1]!.running).toBe(false)
  })
})

describe('findGroupBySession', () => {
  it('finds the row by any member, not just the representative', () => {
    const groups = groupSessions(
      [
        session({ id: 's1', specId: 'spec-a', createdAt: 1, updatedAt: 1 }),
        session({ id: 's2', specId: 'spec-a', createdAt: 2, updatedAt: 2 }),
      ],
      idle,
    )

    expect(findGroupBySession(groups, 's1')?.key).toBe('spec-a')
    expect(findGroupBySession(groups, 's2')?.key).toBe('spec-a')
    expect(findGroupBySession(groups, 'nope')).toBeUndefined()
  })
})
