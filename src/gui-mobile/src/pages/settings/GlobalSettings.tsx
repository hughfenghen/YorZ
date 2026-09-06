import { Show, createResource, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { api, type GlobalConfig } from '@shared/api/index.js'
import {
  THEME_MODES,
  THEME_NAMES,
  setThemeMode,
  setThemeName,
  themeMode,
  themeName,
} from '@shared/lib/theme.js'
import { Page } from '@/components/Page.jsx'
import { ErrorNotice, LoadingNotice } from '@/components/ListStates.jsx'
import { Group, Segmented, Toggle } from '@/components/SettingsControls.jsx'
import { showToast } from '@/components/Toast.jsx'
import { isStandalone } from '@/lib/pwa.js'
import { t, useTranslation } from '@/i18n/index.js'

/**
 * 全局设置（二级页）。
 *
 * 只展示桌面端 GlobalConfigDialog 里已经实现、且在移动端讲得通的部分：
 * 默认 Agent、会话结束提示、外观、关于。刻意不展示的三类：
 *   - 快捷键 / 防休眠：需求明确排除，手机上也没有对应交互；
 *   - 全局自定义指令：桌面端也没有编辑 UI，不属于「当前已实现的设置」。
 *
 * **写回必须是读-改-写**：`PUT /api/global-config` 是整体覆写语义，
 * 直接提交一个只含展示字段的对象，会把 shortcuts / power / customInstructions
 * 全部清空。下面的 patch() 始终基于最近一次 GET 的完整对象做浅合并。
 *
 * **外观不写服务端**：移动端的主题真值在 localStorage（见 @shared/lib/theme.ts
 * 的 persistHint 决策），这里改外观只动本地信号，`config.appearance` 原样保留回写，
 * 不会把桌面端的外观也一起改掉。
 */

const AGENT_KINDS = [
  { value: 'claude' as const, label: 'Claude' },
  { value: 'codex' as const, label: 'Codex' },
  { value: 'opencode' as const, label: 'opencode' },
]

const LANGUAGES = [
  { value: 'zh-CN' as const, label: '中文' },
  { value: 'en' as const, label: 'English' },
]

export const GlobalSettings: Component = () => {
  const navigate = useNavigate()
  const { lng, changeLanguage } = useTranslation()
  const [config, { refetch, mutate }] = createResource<GlobalConfig>(() => api.getGlobalConfig())

  /** 读-改-写：拿最近一次 GET 的完整对象做浅合并后整体回写。 */
  const patch = async (next: GlobalConfig) => {
    const prev = config()
    mutate(next) // 乐观更新：移动端点一下要立刻有反馈
    try {
      const saved = await api.updateGlobalConfig(next)
      mutate(saved.config)
    } catch (e) {
      mutate(prev)
      showToast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <Page title={t('globalSettings.title')} onBack={() => navigate('/projects')}>
      <Show when={!config.loading} fallback={<LoadingNotice />}>
        <Show
          when={!config.error}
          fallback={<ErrorNotice error={config.error} onRetry={() => void refetch()} />}
        >
          <Show when={config()}>
            {(cfg) => (
              <>
                <Group title={t('globalSettings.agent')}>
                  <Segmented
                    label={t('globalSettings.defaultKind')}
                    options={AGENT_KINDS}
                    value={() => cfg().agent.defaultKind}
                    onChange={(defaultKind) =>
                      void patch({ ...cfg(), agent: { ...cfg().agent, defaultKind } })
                    }
                  />
                </Group>

                <Group title={t('globalSettings.notifications')}>
                  <Toggle
                    label={t('globalSettings.sessionEndBanner')}
                    checked={() => cfg().notifications.sessionEnd.banner}
                    onChange={(banner) =>
                      void patch({
                        ...cfg(),
                        notifications: {
                          ...cfg().notifications,
                          sessionEnd: { ...cfg().notifications.sessionEnd, banner },
                        },
                      })
                    }
                  />
                  <Toggle
                    label={t('globalSettings.sessionEndSound')}
                    checked={() => cfg().notifications.sessionEnd.sound}
                    onChange={(sound) =>
                      void patch({
                        ...cfg(),
                        notifications: {
                          ...cfg().notifications,
                          sessionEnd: { ...cfg().notifications.sessionEnd, sound },
                        },
                      })
                    }
                  />
                </Group>

                <Group title={t('globalSettings.appearance')}>
                  <Segmented
                    label={t('globalSettings.themeMode')}
                    options={THEME_MODES.map((mode) => ({
                      value: mode,
                      label: t(`theme.${mode}`),
                    }))}
                    value={themeMode}
                    onChange={setThemeMode}
                  />
                  <Segmented
                    label={t('globalSettings.themeName')}
                    options={THEME_NAMES.map((name) => ({
                      value: name,
                      label: t(`theme.${name}`),
                    }))}
                    value={themeName}
                    onChange={setThemeName}
                  />
                  <Segmented
                    label={t('globalSettings.language')}
                    options={LANGUAGES}
                    value={() => (lng().startsWith('zh') ? 'zh-CN' : 'en')}
                    onChange={(value) => changeLanguage(value)}
                  />
                </Group>

                <Group title={t('globalSettings.about')}>
                  <div class="flex items-center justify-between px-4 py-3 text-sm">
                    <span>{t('globalSettings.version')}</span>
                    <span class="text-muted-foreground">{__APP_VERSION__}</span>
                  </div>
                  <div class="flex items-center justify-between px-4 py-3 text-sm">
                    <span>{t('globalSettings.installState')}</span>
                    <span class="text-muted-foreground">
                      {isStandalone() ? t('globalSettings.installed') : t('globalSettings.browser')}
                    </span>
                  </div>
                </Group>
              </>
            )}
          </Show>
        </Show>
      </Show>
    </Page>
  )
}
