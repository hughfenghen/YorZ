import { Show, createMemo, createResource, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import {
  api,
  type AgentConfig,
  type AgentDescriptor,
  type AgentModelCatalog,
  type ProjectConfig,
} from '@shared/api/index.js'
import { displayProjectName } from '@shared/api/project.js'
import { Page } from '@/components/Page.jsx'
import { ErrorNotice, LoadingNotice, NoProjectNotice } from '@/components/ListStates.jsx'
import { Group, SettingsSelect } from '@/components/SettingsControls.jsx'
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
  const catalogSource = createMemo(() => {
    const pid = activeProjectId()
    const kind = config()?.agent.kind
    return pid && kind && kind !== 'inherit' ? { pid, kind } : undefined
  })
  const [catalog] = createResource<AgentModelCatalog, { pid: string; kind: string }>(
    catalogSource,
    ({ pid, kind }) => api.listAgentModels(pid, kind),
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

  const modelOptions = (cfg: ProjectConfig) => {
    const options = [
      { value: '', label: t('projectSettings.agentDefaultOption') },
      ...(catalog()?.models ?? []).map((item) => ({ value: item.id, label: item.displayName })),
    ]
    const selected = cfg.agent.model ?? ''
    if (selected && !options.some((item) => item.value === selected)) {
      options.push({ value: selected, label: selected })
    }
    return options
  }

  const reasoningOptions = (cfg: ProjectConfig) => {
    const selectedModel = cfg.agent.model ?? ''
    const choices = selectedModel
      ? (catalog()?.models.find((item) => item.id === selectedModel)?.reasoningEfforts ?? [])
      : (catalog()?.defaultReasoningEfforts ?? [])
    const options = [
      { value: '', label: t('projectSettings.agentDefaultOption') },
      ...choices.map((item) => ({ value: item.id, label: item.displayName })),
    ]
    const selected = cfg.agent.reasoningEffort ?? ''
    if (selected && !options.some((item) => item.value === selected)) {
      options.push({ value: selected, label: selected })
    }
    return options
  }

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
  const onModelChange = (cfg: ProjectConfig, model: string) =>
    void save({ kind: cfg.agent.kind, ...(model ? { model } : {}) })
  const onReasoningChange = (cfg: ProjectConfig, reasoningEffort: string) =>
    void save({
      kind: cfg.agent.kind,
      ...(cfg.agent.model ? { model: cfg.agent.model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    })

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
                  <SettingsSelect
                    label={t('projectSettings.kind')}
                    options={kindOptions()}
                    value={() => cfg().agent.kind}
                    onChange={onKindChange}
                  />
                  <SettingsSelect
                    label={t('projectSettings.model')}
                    options={modelOptions(cfg())}
                    value={() => cfg().agent.model ?? ''}
                    disabled={() =>
                      cfg().agent.kind === 'inherit' ||
                      catalog.loading ||
                      modelOptions(cfg()).length <= 1
                    }
                    onChange={(model) => onModelChange(cfg(), model)}
                  />
                  <SettingsSelect
                    label={t('projectSettings.reasoningEffort')}
                    options={reasoningOptions(cfg())}
                    value={() => cfg().agent.reasoningEffort ?? ''}
                    disabled={() =>
                      cfg().agent.kind === 'inherit' ||
                      catalog.loading ||
                      reasoningOptions(cfg()).length <= 1
                    }
                    onChange={(value) => onReasoningChange(cfg(), value)}
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
