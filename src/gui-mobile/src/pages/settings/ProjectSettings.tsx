import { Show, createMemo, createResource, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { api, type AgentConfig, type ProjectConfig } from '@shared/api/index.js'
import { displayProjectName } from '@shared/api/project.js'
import { Page } from '@/components/Page.jsx'
import { ErrorNotice, LoadingNotice, NoProjectNotice } from '@/components/ListStates.jsx'
import { Group, Segmented, TextField } from '@/components/SettingsControls.jsx'
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

type AgentKindOption = 'inherit' | 'claude' | 'codex' | 'opencode' | 'custom'

// 写成函数而不是模块级常量：t() 在模块求值时 i18n 还没 init 完，
// 且切语言后常量不会重算，标签会卡在初始语言上。
//
// 「自定义命令」默认不出现在手机上：这一档要现填命令与参数，手机没有补全、
// 填错了会让整个项目跑不起来，属于该在桌面端做的事。但如果当前配置本来就是
// custom（在桌面端设过），仍要把这一档补回来——否则分段控件没有任何一档高亮，
// 用户既看不出当前用的是什么，也改不回去。
const kindOptions = (
  current: AgentKindOption,
): readonly { value: AgentKindOption; label: string }[] => {
  const base: { value: AgentKindOption; label: string }[] = [
    { value: 'inherit', label: t('projectSettings.inherit') },
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: 'opencode', label: 'opencode' },
  ]
  if (current === 'custom') base.push({ value: 'custom', label: t('projectSettings.custom') })
  return base
}

export const ProjectSettings: Component = () => {
  const navigate = useNavigate()
  const [config, { refetch, mutate }] = createResource<ProjectConfig, string>(
    () => activeProjectId() ?? undefined,
    (pid) => api.getProjectConfig(pid),
  )

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

  const onKindChange = (kind: AgentKindOption) => {
    const cur = config()?.agent
    if (kind !== 'custom') return void save({ kind })
    // 从别的档切到 custom 时保留上一次填过的 cmd/args，不清空
    const cmd = cur?.kind === 'custom' ? cur.cmd : ''
    const args = cur?.kind === 'custom' ? cur.args : []
    return void save({ kind: 'custom', cmd, args })
  }

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
                    options={kindOptions(cfg().agent.kind)}
                    value={() => cfg().agent.kind}
                    onChange={onKindChange}
                  />
                  <Show when={cfg().agent.kind === 'custom' ? cfg().agent : null}>
                    {(agent) => (
                      <>
                        <TextField
                          label={t('projectSettings.cmd')}
                          value={() => (agent() as { cmd: string }).cmd}
                          placeholder="claude"
                          onCommit={(cmd) => {
                            if (!cmd.trim()) {
                              showToast(t('projectSettings.cmdRequired'), 'error')
                              return
                            }
                            void save({
                              kind: 'custom',
                              cmd: cmd.trim(),
                              args: (agent() as { args: string[] }).args,
                            })
                          }}
                        />
                        <TextField
                          label={t('projectSettings.args')}
                          hint={t('projectSettings.argsHint')}
                          value={() => (agent() as { args: string[] }).args.join(' ')}
                          onCommit={(raw) =>
                            void save({
                              kind: 'custom',
                              cmd: (agent() as { cmd: string }).cmd,
                              args: raw.split(/\s+/).filter(Boolean),
                            })
                          }
                        />
                      </>
                    )}
                  </Show>
                </Group>
              )}
            </Show>
          </Show>
        </Show>
      </Show>
    </Page>
  )
}
