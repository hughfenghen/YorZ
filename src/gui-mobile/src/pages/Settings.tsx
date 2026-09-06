import { For, type Component, type JSX } from 'solid-js'
import { Page } from '@/components/Page.jsx'
import { cn } from '@/lib/cn'
import { t, useTranslation } from '@/i18n/index.js'
import { isStandalone } from '@/lib/pwa.js'
import {
  THEME_MODES,
  THEME_NAMES,
  setThemeMode,
  setThemeName,
  themeMode,
  themeName,
} from '@/lib/theme.js'

/**
 * 设置页。这些不是业务功能，而是外壳自身的开关（外观 / 语言 / 安装状态），
 * 放进骨架里正好用来验证令牌与 i18n 在真机上确实生效。
 */

const LANGUAGES = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
] as const

/** 分段控件：移动端优先于下拉菜单——选项少的时候少一次弹层交互。 */
function Segmented<T extends string>(props: {
  label: string
  options: readonly { value: T; label: string }[]
  value: () => T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div class="flex items-center justify-between gap-3 px-4 py-3">
      <span class="shrink-0 text-sm">{props.label}</span>
      <div
        class="flex shrink-0 overflow-hidden rounded-md border border-border"
        role="group"
        aria-label={props.label}
      >
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              class={cn(
                'min-h-9 px-3 text-xs transition-colors',
                props.value() === option.value
                  ? 'bg-primary-soft text-foreground'
                  : 'bg-background text-muted-foreground',
              )}
              aria-pressed={props.value() === option.value}
              onClick={() => props.onChange(option.value)}
            >
              {option.label}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

const Group: Component<{ title: string; children: JSX.Element }> = (props) => (
  <section class="mb-6">
    <h2 class="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {props.title}
    </h2>
    <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {props.children}
    </div>
  </section>
)

export const Settings: Component = () => {
  const { lng, changeLanguage } = useTranslation()

  return (
    <Page title={t('settings.title')}>
      <Group title={t('settings.appearance')}>
        <Segmented
          label={t('settings.themeMode')}
          options={THEME_MODES.map((mode) => ({ value: mode, label: t(`theme.${mode}`) }))}
          value={themeMode}
          onChange={setThemeMode}
        />
        <Segmented
          label={t('settings.themeName')}
          options={THEME_NAMES.map((name) => ({ value: name, label: t(`theme.${name}`) }))}
          value={themeName}
          onChange={setThemeName}
        />
        <Segmented
          label={t('settings.language')}
          options={LANGUAGES}
          value={() => (lng().startsWith('zh') ? 'zh-CN' : 'en')}
          onChange={(value) => void changeLanguage(value)}
        />
      </Group>

      <Group title={t('settings.about')}>
        <div class="flex items-center justify-between px-4 py-3 text-sm">
          <span>{t('settings.version')}</span>
          <span class="text-muted-foreground">{__APP_VERSION__}</span>
        </div>
        <div class="flex items-center justify-between px-4 py-3 text-sm">
          <span>{t('settings.installState')}</span>
          <span class="text-muted-foreground">
            {isStandalone() ? t('settings.installed') : t('settings.browser')}
          </span>
        </div>
      </Group>
    </Page>
  )
}
