import { Show, createMemo, createResource, type Component } from 'solid-js'
import { api } from '@shared/api/index.js'
import { formatAgentUsageSummary } from '@shared/lib/agent-usage.js'
import { activeProjectId } from '@/lib/active-project.js'
import { t, useTranslation } from '@/i18n/index.js'

/**
 * 空态里的 Agent 剩余用量摘要，与桌面端 ChatPanel 的「未选中会话」提示同源
 * （文案组装在 `@shared/lib/agent-usage`，键名同为 `chat.usage*`）。
 *
 * 只在空态里挂载，请求也就只发生在空态：正常有会话可看的时候没人关心余额，
 * 每次进列表都探一次配额纯属浪费。
 */
export const AgentUsageHint: Component = () => {
  const { lng } = useTranslation()
  const [usage] = createResource(
    () => activeProjectId() || undefined,
    (pid) => api.getAgentUsageStatus(pid),
  )

  const summary = createMemo(() => {
    lng()
    // 查询失败不该把空态变成错误页：这只是一条附带信息，静默隐藏即可。
    if (usage.error) return ''
    return formatAgentUsageSummary(usage.latest, usage.loading, {
      t,
      formatTime: (date) => date.toLocaleString(lng()),
    })
  })

  return (
    <Show when={summary()}>
      {(text) => <p class="text-xs text-muted-foreground/80">{text()}</p>}
    </Show>
  )
}
