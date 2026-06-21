const STORAGE_KEY = 'yorz:recent-specs'
const MAX_ITEMS = 10

export interface RecentSpecEntry {
  specId: string
  lastAccessedAt: number
}

export function getRecentSpecs(): RecentSpecEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RecentSpecEntry[]
    if (!Array.isArray(parsed)) return []
    return parsed.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt).slice(0, MAX_ITEMS)
  } catch {
    return []
  }
}

export function addRecentSpec(specId: string): void {
  try {
    const entries = getRecentSpecs().filter((e) => e.specId !== specId)
    entries.unshift({ specId, lastAccessedAt: Date.now() })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ITEMS)))
  } catch {
    // localStorage might be unavailable (private mode, etc.)
  }
}

export function clearRecentSpecs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // noop
  }
}
