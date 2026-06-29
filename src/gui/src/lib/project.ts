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
 * 响应式取当前 pid：基于 useParams().projectId（SolidRouter 中唯一先于 pushState 同步更新的真相源）。
 * 命令式入口已废弃，所有 project-scoped api / sse 调用需显式传 pid。
 */
export function useCurrentProjectId(): () => string {
  const params = useParams<{ projectId?: string }>()
  return () => params.projectId ?? activeProjectId()
}

/** Build a route href under the given (or current) project. */
export function projectHref(sub: string = '', projectId?: string): string {
  const pid = projectId ?? activeProjectId()
  if (!pid) return sub.startsWith('/') ? sub : `/${sub}`
  const tail = sub.startsWith('/') ? sub : sub ? `/${sub}` : ''
  return `/${pid}${tail}`
}

export interface WorktreeMeta {
  mainProjectId: string
  mainPath: string
  branch: string
  specId: string
  createdAt: string
}

export interface ProjectListItem {
  id: string
  name: string
  path: string
  lastActivityAt: string | null
  worktree?: WorktreeMeta
}
