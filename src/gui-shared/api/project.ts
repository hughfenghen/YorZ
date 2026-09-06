/**
 * 项目相关的数据类型。
 *
 * 这些类型对应后端 src/service/project-registry.ts 的返回结构，与平台无关，
 * 两端共用。桌面端 src/gui/src/lib/project.ts 里那些依赖 @solidjs/router 与
 * `/:projectId` URL 形状的响应式工具（activeProjectId / useCurrentProjectId /
 * projectHref）刻意留在桌面端 —— 移动端用的是全局单选模型
 * （src/gui-mobile/src/lib/active-project.ts），不共享这套 URL 语义。
 */

export interface WorktreeMeta {
  mainProjectId: string
  mainPath: string
  branch: string
  specId: string
  createdAt: string
  cleanSlug?: string
}

export interface ProjectListItem {
  id: string
  name: string
  path: string
  lastActivityAt: string | null
  worktree?: WorktreeMeta
}

/**
 * 列表里显示的项目名。
 *
 * 普通项目直接用 `name`；worktree 项目单看 name 全是同一个仓库名，
 * 拼成「主目录 · slug」才能一眼区分是哪条分支的工作树。
 */
export function displayProjectName(p: ProjectListItem): string {
  if (!p.worktree) return p.name
  const mainBasename = p.worktree.mainPath.split('/').filter(Boolean).pop() ?? p.worktree.mainPath
  const slug = p.worktree.cleanSlug ?? p.worktree.branch.replace(/^wt\//, '')
  return `${mainBasename} · ${slug}`
}
