import { useParams } from '@solidjs/router'
import { createSignal } from 'solid-js'

const [activeProjectId, setActiveProjectId] = createSignal(initialProjectIdFromUrl())

function initialProjectIdFromUrl(): string {
  if (typeof window === 'undefined') return ''
  const m = window.location.pathname.match(/^\/([^/]+)/)
  return m && m[1] !== 'api' ? m[1]! : ''
}

export { activeProjectId, setActiveProjectId }

/**
 * Read the current project id. Backed by a reactive signal that is kept in sync
 * with `@solidjs/router`'s `useLocation()` in `AppShell`. Safe to call from any
 * context (component or plain module) — reactive consumers subscribe, plain
 * callers just see the current value.
 */
export function currentProjectId(): string {
  return activeProjectId()
}

export function useCurrentProjectId(): () => string {
  const params = useParams<{ projectId?: string }>()
  return () => params.projectId ?? activeProjectId()
}

/** Build a route href under the given (or current) project. */
export function projectHref(sub: string = '', projectId?: string): string {
  const pid = projectId ?? currentProjectId()
  if (!pid) return sub.startsWith('/') ? sub : `/${sub}`
  const tail = sub.startsWith('/') ? sub : sub ? `/${sub}` : ''
  return `/${pid}${tail}`
}

export interface ProjectListItem {
  id: string
  name: string
  path: string
  lastActivityAt: string | null
}
