import type { AgentUsageStatus, AgentUsageWindow } from '../api/index.js'

/**
 * Agent 剩余用量摘要的文案组装。
 *
 * 两端展示位置不同（桌面在「未选中会话」的聊天区，移动端在会话列表 / 草稿的
 * 空态），但分支完全一样：loading / 不支持 / 需安装 / 查询失败 / 无明细 /
 * 有窗口明细共 6 条。复制一份必然漂移，所以逻辑放共享层，两端只提供
 * 翻译函数与时间格式化。
 *
 * 文案键沿用桌面端既有的 `chat.usage*` 命名，移动端词典按同名补齐。
 */

export interface UsageSummaryDeps {
  /** i18next 风格的翻译函数。 */
  t: (key: string, params?: Record<string, unknown>) => string
  /** 把重置时刻格式化成本地时间串；locale 由调用端决定。 */
  formatTime: (date: Date) => string
}

/** 最多展示两个窗口：再多在窄屏上会挤成一坨，信息价值也递减。 */
const MAX_WINDOWS = 2

function formatReset(iso: string | null, deps: UsageSummaryDeps): string {
  if (!iso) return deps.t('chat.usageResetUnknown')
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return deps.t('chat.usageResetUnknown')
  return deps.formatTime(date)
}

function formatWindow(win: AgentUsageWindow, deps: UsageSummaryDeps): string {
  if (typeof win.utilization !== 'number') {
    return deps.t('chat.usageWindowUnknown', { label: win.label })
  }
  const used = Math.min(100, Math.max(0, Math.round(win.utilization)))
  return deps.t('chat.usageWindow', {
    label: win.label,
    remaining: Math.max(0, 100 - used),
    used,
    reset: formatReset(win.resetsAt, deps),
  })
}

/**
 * 组装一行摘要；返回空串表示「没有可说的」，调用端据此决定是否渲染。
 */
export function formatAgentUsageSummary(
  usage: AgentUsageStatus | undefined | null,
  loading: boolean,
  deps: UsageSummaryDeps,
): string {
  if (loading) return deps.t('chat.usageLoading')
  if (!usage) return ''
  if (usage.status === 'error') return deps.t('chat.usageError', { kind: usage.kind })
  if (usage.status === 'unavailable' && usage.installCommand) {
    return deps.t('chat.usageInstallHint', { kind: usage.kind, command: usage.installCommand })
  }
  if (usage.status === 'unavailable') return deps.t('chat.usageUnavailable', { kind: usage.kind })
  const windows = usage.windows ?? []
  if (windows.length === 0) return deps.t('chat.usageAvailableNoDetails', { kind: usage.kind })
  return deps.t('chat.usageSummary', {
    kind: usage.kind,
    details: windows
      .slice(0, MAX_WINDOWS)
      .map((win) => formatWindow(win, deps))
      .join(deps.t('chat.usageSeparator')),
  })
}
