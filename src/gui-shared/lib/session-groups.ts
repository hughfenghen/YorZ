import type { SessionInfo } from '../api/index.js'

/**
 * A row in the Chat panel's session list.
 *
 * A spec owns many sessions now — one per system-driven round (run / append /
 * git-ops) — because reusing a single session made every later round inherit
 * the earlier ones' transcript. The list is where that fan-out is folded back
 * up: all sessions of a spec render as ONE row, so the panel looks exactly as it
 * did when the spec really had a single session.
 *
 * Grouping is a pure projection over `specId`; there is no group entity on the
 * server, and sessions without a `specId` (plain chats) each form their own
 * single-member group.
 */
export interface SessionGroup {
  /** Stable identity: the specId, or the session id for ungrouped chats. */
  key: string
  specId?: string
  /** Oldest first — the order the rounds happened in. */
  sessions: SessionInfo[]
  /** Most recently active member: the row's title, kind, and send target. */
  latest: SessionInfo
  /** Newest activity in the group; drives the list's "latest floats up" order. */
  updatedAt: number
  /** Any member has a turn in flight. */
  running: boolean
}

/**
 * Fold a session list into list rows.
 *
 * Input order is preserved for ungrouped sessions and for the relative order of
 * groups (the caller's list already arrives sorted by activity, running first),
 * so this deliberately does NOT re-sort: re-sorting here would drop the server's
 * "a running session's activity is *now*" rule.
 */
export function groupSessions(
  sessions: readonly SessionInfo[],
  isRunning: (sid: string) => boolean,
): SessionGroup[] {
  const groups: SessionGroup[] = []
  const bySpec = new Map<string, SessionGroup>()

  for (const s of sessions) {
    const running = isRunning(s.id)
    if (!s.specId) {
      groups.push({
        key: s.id,
        sessions: [s],
        latest: s,
        updatedAt: s.updatedAt,
        running,
      })
      continue
    }
    const existing = bySpec.get(s.specId)
    if (!existing) {
      const group: SessionGroup = {
        key: s.specId,
        specId: s.specId,
        sessions: [s],
        latest: s,
        updatedAt: s.updatedAt,
        running,
      }
      bySpec.set(s.specId, group)
      groups.push(group)
      continue
    }
    existing.sessions.push(s)
    if (s.updatedAt > existing.latest.updatedAt) existing.latest = s
    existing.updatedAt = Math.max(existing.updatedAt, s.updatedAt)
    existing.running ||= running
  }

  for (const group of bySpec.values()) {
    group.sessions.sort((a, b) => a.createdAt - b.createdAt)
  }
  return groups
}

/** The row a session id belongs to, or undefined when it is not in the list. */
export function findGroupBySession(
  groups: readonly SessionGroup[],
  sid: string,
): SessionGroup | undefined {
  return groups.find((g) => g.sessions.some((s) => s.id === sid))
}
