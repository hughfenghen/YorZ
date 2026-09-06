import { createResource, createSignal, type Resource } from 'solid-js'
import { api } from '@shared/api/index.js'
import type { ProjectListItem } from '@shared/api/project.js'
import { subscribeProjectsList } from '@shared/api/sse.js'

/**
 * 移动端的「活动项目」。
 *
 * 桌面端把 pid 放在 URL 第一段（`/:projectId/...`），是为了多标签页各自停在不同项目；
 * 移动端是单窗口 PWA，线框图也画成「勾选一个项目、其余 tab 跟随」，
 * 所以这里用全局信号 + localStorage，而不是 URL scope——
 * 放进 URL 会让每个 tab 路径都带 pid，深链与 SW 缓存都跟着变复杂。
 *
 * 一致性规则：选中的 id 必须存在于 `GET /api/projects` 的结果里。
 * 首次进入（或项目被删除 / 换机器）时若对不上，回退为列表第一项；
 * 列表为空则为 null，各页显示引导空态——移动端不提供「添加项目」，
 * 因为 `POST /api/projects` 要求传绝对路径，手机上无从选择。
 */

const STORAGE_KEY = 'yorz.mobile.activeProjectId'

function readStored(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // 隐私模式下 localStorage 可能不可用；读不到只会退回列表第一项。
    return null
  }
}

function writeStored(id: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 写不进去只影响下次冷启动的初值，不影响本次会话。
  }
}

const [activeProjectId, setActiveProjectIdSignal] = createSignal<string | null>(readStored())

export { activeProjectId }

/** 用户显式切换项目。 */
export function setActiveProjectId(id: string | null): void {
  setActiveProjectIdSignal(id)
  writeStored(id)
}

/**
 * 用最新的项目列表校正选中态：id 已失效时回退列表第一项，列表为空时清空。
 * 与用户显式切换共用一套写盘逻辑，保证 localStorage 里永远是一个「当时有效」的 id。
 */
export function reconcileActiveProject(projects: readonly ProjectListItem[]): void {
  const current = activeProjectId()
  if (current && projects.some((p) => p.id === current)) return
  setActiveProjectId(projects[0]?.id ?? null)
}

/**
 * 项目列表的单一数据源：一处 `createResource` + 一路 SSE，四个页面共用。
 *
 * 之所以做成模块级单例而不是每个页面各拉一次：`projects` 是选中态的校正依据，
 * 各页各拉会出现「项目页已经校正、Sessions 页还在用旧 id」的错位。
 */
const [projects, { refetch: refetchProjects }] = createResource<ProjectListItem[]>(async () => {
  const list = await api.listProjects()
  reconcileActiveProject(list)
  return list
})

export { projects, refetchProjects }

if (typeof window !== 'undefined') {
  // 项目增删（桌面端操作、worktree 创建等）都会推这个 topic；
  // 订阅在模块级注册一次，随页面生命周期无关——移动端只有一个窗口。
  subscribeProjectsList(() => void refetchProjects())
}

/** 当前活动项目的完整记录；列表未加载或 id 失效时为 undefined。 */
export function activeProject(): ProjectListItem | undefined {
  const id = activeProjectId()
  if (!id) return undefined
  return projects()?.find((p) => p.id === id)
}

export type ProjectsResource = Resource<ProjectListItem[]>
