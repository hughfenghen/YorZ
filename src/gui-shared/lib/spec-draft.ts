import type { CreateSpecBody } from '../api/index.js'

export type SpecType = CreateSpecBody['type']

/**
 * The "new spec" form's local draft + the post-submit discovery poll.
 *
 * Both halves are pure browser logic with no UI in them, and both must behave
 * identically on desktop and mobile: the draft key is deliberately the same on
 * both (editing the same project from either client resumes the same text), and
 * the poll is the only way to learn the id of a spec the agent is still drafting
 * — `POST /specs` answers 202 with a runId, not an id.
 */

export interface NewSpecDraft {
  content: string
  type: SpecType
  /** Desktop-only worktree toggle; mobile always stores `false`. */
  useWorktree: boolean
}

export const DRAFT_STORAGE_PREFIX = 'yorz:new-spec-draft:'

export function isSpecType(value: unknown): value is SpecType {
  return value === 'feat' || value === 'refct' || value === 'fix'
}

export function draftStorageKey(pid: string): string {
  return `${DRAFT_STORAGE_PREFIX}${pid}`
}

export function readDraft(pid: string): Partial<NewSpecDraft> {
  if (!pid || typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(draftStorageKey(pid))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<NewSpecDraft>
    return {
      content: typeof parsed.content === 'string' ? parsed.content : undefined,
      type: isSpecType(parsed.type) ? parsed.type : undefined,
      useWorktree: typeof parsed.useWorktree === 'boolean' ? parsed.useWorktree : undefined,
    }
  } catch {
    return {}
  }
}

export function persistDraft(pid: string, draft: NewSpecDraft): void {
  if (!pid || typeof window === 'undefined') return
  try {
    // 与默认值完全一致的表单不算草稿——否则每次打开页面都会写一条空记录。
    const hasDraft =
      draft.content.trim().length > 0 || draft.type !== 'feat' || draft.useWorktree !== false
    const key = draftStorageKey(pid)
    if (!hasDraft) {
      window.localStorage.removeItem(key)
      return
    }
    window.localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // Storage is best-effort; form input must remain usable when unavailable.
  }
}

export function serializeDraft(draft: NewSpecDraft): string {
  return JSON.stringify(draft)
}

export function clearDraft(pid: string): void {
  if (!pid || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(draftStorageKey(pid))
  } catch {
    // ignore
  }
}

/** worktree 分支名用的 slug；无可用 ASCII 时退到时间戳，保证永远非空且不以数字开头。 */
export function deriveSlug(requirement: string): string {
  const firstLine = requirement.split(/\r?\n/)[0] ?? ''
  const ascii = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (ascii && !/^[0-9]+$/.test(ascii)) return ascii
  return `spec-${Date.now().toString(36)}`
}

export interface NewSpecPoller {
  /** Snapshot the ids that already existed, before dispatching the create. */
  setBaseline(ids: string[]): void
  /** One pass: list, diff against the baseline, fire `onFound` at most once. */
  poll(): Promise<void>
  /** True once `onFound` has fired — callers use it to stop resubscribing. */
  found(): boolean
}

/**
 * Discovers the spec id an agent is drafting, by diffing the spec list against a
 * baseline taken just before the create call. Driven by `list-updated` SSE and
 * one eager pass, since the first event may already have fired by the time we
 * subscribe. Fires at most once, and swallows list errors so a transient failure
 * just waits for the next event.
 */
export function createNewSpecPoller(o: {
  listSpecs: () => Promise<{ id: string }[]>
  onFound: (id: string) => void
}): NewSpecPoller {
  let baseline = new Set<string>()
  let hit = false
  return {
    setBaseline(ids) {
      baseline = new Set(ids)
      hit = false
    },
    async poll() {
      if (hit) return
      try {
        const list = await o.listSpecs()
        const fresh = list.find((s) => !baseline.has(s.id))
        if (!fresh || hit) return
        hit = true
        o.onFound(fresh.id)
      } catch {
        // ignore; will retry on the next list-updated event
      }
    },
    found: () => hit,
  }
}
