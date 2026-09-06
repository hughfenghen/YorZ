import { Show, type Component } from 'solid-js'
import { CloudOff, RefreshCw } from 'lucide-solid'
import { online } from '@/lib/network.js'
import { needRefresh, applyUpdate } from '@/lib/pwa.js'
import { t } from '@/i18n/index.js'

/**
 * 离线 / 有新版本 的横幅。
 *
 * 两者共用一条，因为它们都属于「应用外壳的状态」，同时出现的概率极低，
 * 各占一条会在小屏上挤掉两行内容。离线优先展示：断网时点更新也没意义。
 */
export const StatusBanner: Component = () => (
  <Show when={!online() || needRefresh()}>
    <Show
      when={online()}
      fallback={
        <div
          class="flex items-center gap-2 bg-warning px-4 py-1.5 text-xs text-warning-foreground"
          role="status"
        >
          <CloudOff size={14} aria-hidden="true" />
          <span>{t('pwa.offline')}</span>
        </div>
      }
    >
      <div class="flex items-center gap-2 bg-info px-4 py-1.5 text-xs text-info-foreground">
        <RefreshCw size={14} aria-hidden="true" />
        <span class="flex-1">{t('pwa.needRefresh')}</span>
        <button type="button" class="font-medium underline" onClick={() => applyUpdate()}>
          {t('pwa.refresh')}
        </button>
      </div>
    </Show>
  </Show>
)
