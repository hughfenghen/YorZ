import type { SessionInfo } from '../api/index.js'
import { stripHiddenPrompt } from './chat-blocks.js'

/**
 * Session titles can come from an Agent-owned index rather than YorZ's store.
 * Codex may derive that title from the expanded prompt and truncate it before
 * the closing marker, so handle both a complete block and that unsafe prefix.
 */
function withoutHiddenTitle(session: SessionInfo): SessionInfo {
  const stripped = stripHiddenPrompt(session.title)
  const title = /^\s*<!--\s*yorz:hidden\b/i.test(stripped) ? '' : stripped
  const visibleTitle = title || session.id
  return visibleTitle === session.title ? session : { ...session, title: visibleTitle }
}

/**
 * A row in the Chat panel's session list.
 *
 * A spec owns many sessions now — one per system-driven round (run / append /
 * git-ops) — because reusing a single session made every later round inherit
 * the earlier ones' transcript. The list is where that fan-out is folded back
 * up: all sessions of a spec render as ONE row, so the panel looks exactly as it
 * did when the spec really had a single session.
 *
 * Grouping is a pure projection over `specId` for spec rounds and `groupId` for
 * plain chats. Legacy plain sessions without either field remain single-member
 * groups until `/new` binds a later session to them.
 */
export interface SessionGroup {
  /** Stable identity: specId, plain-chat groupId, or a legacy session id. */
  key: string
  specId?: string
  groupId?: string
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
  const grouped = new Map<string, SessionGroup>()

  for (const raw of sessions) {
    const s = withoutHiddenTitle(raw)
    const running = isRunning(s.id)
    const groupId = s.specId ? undefined : s.groupId
    const identity = s.specId ?? groupId
    if (!identity) {
      groups.push({
        key: s.id,
        sessions: [s],
        latest: s,
        updatedAt: s.updatedAt,
        running,
      })
      continue
    }
    const mapKey = `${s.specId ? 'spec' : 'chat'}:${identity}`
    const existing = grouped.get(mapKey)
    if (!existing) {
      const group: SessionGroup = {
        key: identity,
        specId: s.specId,
        groupId,
        sessions: [s],
        latest: s,
        updatedAt: s.updatedAt,
        running,
      }
      grouped.set(mapKey, group)
      groups.push(group)
      continue
    }
    existing.sessions.push(s)
    if (s.updatedAt > existing.latest.updatedAt) existing.latest = s
    existing.updatedAt = Math.max(existing.updatedAt, s.updatedAt)
    existing.running ||= running
  }

  for (const group of grouped.values()) {
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
