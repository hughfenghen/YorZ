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
  /** 该项目下是否有任意 session 任务正在运行（后端按已缓存实例聚合）。 */
  running: boolean
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

/**
 * 列表每行渲染分组视觉所需的元信息。
 *
 * 由 {@link groupProjects} 从后端返回的扁平 `ProjectListItem[]` 计算得到，
 * 两端（桌面 ProjectsSidebar / 移动 Projects）共享这份结果，各自渲染分组下标。
 */
export interface ProjectGroupInfo {
  project: ProjectListItem
  /** 分组键：分组时 = 源项目 id（`worktree.mainProjectId`），独立项 = `project.id`。 */
  groupId: string
  /** 组大小 ≥ 2（源项目 + 至少 1 个 worktree）时为 true，驱动分组下标渲染。 */
  grouped: boolean
  /** 组长（源项目）= 0，worktree 按活动时间降序排 1、2…；独立项恒为 0。 */
  indexInGroup: number
  groupSize: number
  /** 折叠态字母：分组取源项目 name 首字母、全组一致；独立项取自身 name 首字母。 */
  letter: string
}

function firstLetter(name: string): string {
  return (name[0] ?? '?').toUpperCase()
}

/**
 * 把后端返回的扁平列表重排为「源项目 + 其 worktree 紧随其后」的分组顺序，
 * 并为每一行附带渲染所需的分组元信息。
 *
 * 规则（详见 spec 4.2）：
 * - 以 `worktree.mainProjectId` 为组键聚合，列表中 `id === mainProjectId` 的项为组长；
 * - 仅当某源项目在列表内且至少带 1 个 worktree（组大小 ≥ 2）时才视为「分组」；
 * - 组内：组长排 0，worktree 按原扁平顺序（即活动时间降序）排 1、2…；
 * - 组间：各「单元」（分组或独立项）按其成员的最大新鲜度（最小原始下标）排序，
 *   保证任一成员被触达都会把整组顶上去；独立项以自身下标参与同一排序，彼此穿插；
 * - 孤儿 worktree（`mainProjectId` 不在列表内）按独立项处理（`grouped=false`）。
 *
 * 后端已按活动时间降序返回，故「原始下标越小越新」可直接近似新鲜度。
 */
export function groupProjects(projects: ProjectListItem[]): ProjectGroupInfo[] {
  // 现存 id 集合：用于判断 worktree 的源项目是否在列表内（否则为孤儿）。
  const present = new Set(projects.map((p) => p.id))
  // 组键 -> 该组在原列表中出现的所有成员下标（含组长与 worktree）。
  const members = new Map<string, number[]>()
  const groupKeyOf = (p: ProjectListItem): string =>
    p.worktree && present.has(p.worktree.mainProjectId) ? p.worktree.mainProjectId : p.id

  projects.forEach((p, i) => {
    const key = groupKeyOf(p)
    const arr = members.get(key)
    if (arr) arr.push(i)
    else members.set(key, [i])
  })

  // 每个「单元」= 一个组键 + 其成员下标；freshness 取成员最小下标（最新者）。
  const units = Array.from(members.entries()).map(([key, idxs]) => ({
    key,
    idxs,
    freshness: Math.min(...idxs),
  }))
  // 组间按新鲜度升序（下标越小越新 → 越靠前）；同新鲜度按 key 稳定排序。
  units.sort((a, b) => a.freshness - b.freshness || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const out: ProjectGroupInfo[] = []
  for (const unit of units) {
    const grouped = unit.idxs.length >= 2
    // 组内排序：组长（id === key）置顶，其余 worktree 保持原扁平（活动降序）次序。
    const ordered = [...unit.idxs].sort((a, b) => {
      const aLead = projects[a]!.id === unit.key ? 0 : 1
      const bLead = projects[b]!.id === unit.key ? 0 : 1
      return aLead - bLead || a - b
    })
    const leadIdx = ordered.find((i) => projects[i]!.id === unit.key) ?? ordered[0]!
    const letter = firstLetter(projects[leadIdx]!.name)
    ordered.forEach((idx, pos) => {
      out.push({
        project: projects[idx]!,
        groupId: unit.key,
        grouped,
        indexInGroup: grouped ? pos : 0,
        groupSize: unit.idxs.length,
        letter: grouped ? letter : firstLetter(projects[idx]!.name),
      })
    })
  }
  return out
}
