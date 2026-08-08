import type { CommandRun, SessionInfo } from './api.js'

export interface ProjectActivityReader {
  listCommandRuns(projectId: string): Promise<Array<Pick<CommandRun, 'status'>>>
  listSessions(projectId: string): Promise<Array<Pick<SessionInfo, 'running'>>>
}

export type WorktreeMergeCheck = 'allowed' | 'running' | 'busy'

export type WorktreeMergeResult<T> =
  | { status: 'merged'; value: T }
  | { status: 'blocked'; reason: Exclude<WorktreeMergeCheck, 'allowed'> }

export interface WorktreeMergeGuard {
  /** 检查当前活动状态；同一 Guard 正忙时返回 busy。 */
  check(projectId: string): Promise<WorktreeMergeCheck>
  /** 在前端防重锁内复查活动状态并执行合并。 */
  merge<T>(projectId: string, action: () => Promise<T>): Promise<WorktreeMergeResult<T>>
}

/**
 * 判断当前项目是否仍有会修改 Worktree 的运行任务。
 * @param commandRuns 项目的命令运行记录。
 * @param sessions 项目的 Agent 会话列表。
 * @returns 存在运行中的命令或 Agent 轮次时返回 true。
 */
export function hasRunningProjectTasks(
  commandRuns: Array<Pick<CommandRun, 'status'>>,
  sessions: Array<Pick<SessionInfo, 'running'>>,
): boolean {
  return commandRuns.some((run) => run.status === 'running') || sessions.some((s) => s.running)
}

/**
 * 读取项目最新活动状态并判断是否允许发起 Worktree 合并。
 * @param projectId 待合并的 Worktree 项目 id。
 * @param reader 提供命令与 Agent 会话状态的前端 API。
 * @returns 没有运行任务时返回 true。
 */
export async function canMergeWorktree(
  projectId: string,
  reader: ProjectActivityReader,
): Promise<boolean> {
  const [commandRuns, sessions] = await Promise.all([
    reader.listCommandRuns(projectId),
    reader.listSessions(projectId),
  ])
  return !hasRunningProjectTasks(commandRuns, sessions)
}

/**
 * 创建页面级合并校验器，避免检查期间或合并期间重复提交。
 * @param reader 提供命令与 Agent 会话状态的前端 API。
 * @param onBusyChange 可选忙碌状态回调，用于同步按钮禁用状态。
 * @returns 可复用的活动检查与受保护合并入口。
 */
export function createWorktreeMergeGuard(
  reader: ProjectActivityReader,
  onBusyChange: (busy: boolean) => void = () => {},
): WorktreeMergeGuard {
  let busy = false

  /** 在互斥区间内执行操作，并保证忙碌状态最终恢复。 */
  async function withBusy<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined
    busy = true
    onBusyChange(true)
    try {
      return await operation()
    } finally {
      busy = false
      onBusyChange(false)
    }
  }

  return {
    async check(projectId) {
      const allowed = await withBusy(() => canMergeWorktree(projectId, reader))
      if (allowed === undefined) return 'busy'
      return allowed ? 'allowed' : 'running'
    },
    async merge<T>(projectId: string, action: () => Promise<T>) {
      const result = await withBusy(async (): Promise<WorktreeMergeResult<T>> => {
        if (!(await canMergeWorktree(projectId, reader))) {
          return { status: 'blocked', reason: 'running' }
        }
        return { status: 'merged', value: await action() }
      })
      return result ?? { status: 'blocked', reason: 'busy' }
    },
  }
}
