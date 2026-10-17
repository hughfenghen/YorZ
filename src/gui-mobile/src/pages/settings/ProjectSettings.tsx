import { Show, createMemo, createResource, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { api, type AgentConfig, type AgentDescriptor, type ProjectConfig } from '@shared/api/index.js'
import { displayProjectName } from '@shared/api/project.js'
import { Page } from '@/components/Page.jsx'
import { ErrorNotice, LoadingNotice, NoProjectNotice } from '@/components/ListStates.jsx'
import { Group, Segmented } from '@/components/SettingsControls.jsx'
import { showToast } from '@/components/Toast.jsx'
import { activeProject, activeProjectId } from '@/lib/active-project.js'
import { t } from '@/i18n/index.js'

/**
 * 项目设置（二级页），作用于当前活动项目。
 *
 * 只有 Agent 覆写一组：
 *   - spec 文档目录（specsDir）：需求明确排除，且手机上编辑路径没有补全可用；
 *   - 脚本（commands）：由「扩展」tab 的脚本管理承载，不进设置页；
 *   - 项目自定义指令：桌面端也没有编辑 UI。
 *
 * **写回同样是读-改-写**：`PUT /api/projects/:pid/config` 收 `{ agent, specsDir }`，
 * specsDir 必须原样带回最近一次 GET 的值，否则会被后端按缺省值重置。
 * commands / customInstructions 由各自的路由管理，不经过这里。
 */

// Builtin display labels; external agents use their descriptor.displayName.
const BUILTIN_LABEL: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'opencode',
  pi: 'Pi',
}

export const ProjectSettings: Component = () => {
  const navigate = useNavigate()
  const [config, { refetch, mutate }] = createResource<ProjectConfig, string>(
    () => activeProjectId() ?? undefined,
    (pid) => api.getProjectConfig(pid),
  )
  // Agent roster (builtin + external) from the single `/agents` source, so the
  // segmented control is no longer a hardcoded list.
  const [agents] = createResource<AgentDescriptor[], string>(
    () => activeProjectId() ?? undefined,
    (pid) => api.listAgents(pid),
  )

  // 写成函数而不是模块级常量：t() 在模块求值时 i18n 还没 init 完，
  // 且切语言后常量不会重算，标签会卡在初始语言上。
  const kindOptions = (): readonly { value: string; label: string }[] => [
    { value: 'inherit', label: t('projectSettings.inherit') },
    ...(agents() ?? []).map((d) => ({
      value: d.id,
      label: d.source === 'external' ? d.displayName : (BUILTIN_LABEL[d.id] ?? d.displayName),
    })),
  ]

  // 标题用项目名而不是「项目设置」：二级页面从项目行进来，
  // 用户需要确认改的是哪个项目，而不是重复一遍入口文案。
  const title = createMemo(() => {
    const p = activeProject()
    return p ? displayProjectName(p) : t('projectSettings.title')
  })

  const save = async (agent: AgentConfig) => {
    const pid = activeProjectId()
    const prev = config()
    if (!pid || !prev) return
    mutate({ ...prev, agent })
    try {
      // specsDir 原样回传：接口是整体覆写，漏传等于把用户设的目录抹掉
      const saved = await api.updateProjectConfig(pid, { agent, specsDir: prev.specsDir })
      mutate(saved.config)
    } catch (e) {
      mutate(prev)
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const onKindChange = (kind: string) => void save({ kind })

  return (
    <Page title={title()} onBack={() => navigate('/projects')}>
      <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
        <Show when={!config.loading} fallback={<LoadingNotice />}>
          <Show
            when={!config.error}
            fallback={<ErrorNotice error={config.error} onRetry={() => void refetch()} />}
          >
            <Show when={config()}>
              {(cfg) => (
                <Group title={t('projectSettings.agent')}>
                  <Segmented
                    label={t('projectSettings.kind')}
                    options={kindOptions()}
                    value={() => cfg().agent.kind}
                    onChange={onKindChange}
                  />
                </Group>
              )}
            </Show>
          </Show>
        </Show>
      </Show>
    </Page>
  )
}
