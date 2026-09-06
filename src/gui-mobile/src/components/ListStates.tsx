import { Show, type Component, type JSX } from 'solid-js'
import { t } from '@/i18n/index.js'
import { showToast } from './Toast.jsx'

/**
 * 列表页的四种非正常态（加载中 / 出错 / 空 / 未选项目）的统一呈现。
 *
 * 抽出来是因为四个一级页面对这几种状态的处理完全一致，各写一遍只会漂移；
 * 但它们**不**放进 gui-shared——桌面端用的是侧栏 + Suspense 骨架的另一套呈现，
 * 共享这层只会让两端互相牵制。
 */

export const Notice: Component<{ title: string; hint?: string; action?: JSX.Element }> = (
  props,
) => (
  <div class="flex flex-col items-center gap-2 px-8 py-16 text-center">
    <p class="text-sm text-muted-foreground">{props.title}</p>
    <Show when={props.hint}>
      <p class="text-xs text-muted-foreground/80">{props.hint}</p>
    </Show>
    <Show when={props.action}>
      <div class="pt-2">{props.action}</div>
    </Show>
  </div>
)

export const LoadingNotice: Component = () => <Notice title={t('common.loading')} />

export const ErrorNotice: Component<{ error: unknown; onRetry: () => void }> = (props) => (
  <Notice
    title={t('common.error')}
    hint={props.error instanceof Error ? props.error.message : String(props.error)}
    action={
      <button
        type="button"
        class="min-h-11 rounded-md border border-border px-4 text-sm active:bg-accent"
        onClick={() => props.onRetry()}
      >
        {t('common.retry')}
      </button>
    }
  />
)

/** 未选中任何项目时，Sessions / Specs / 扩展 三个 project-scoped 页面的引导态。 */
export const NoProjectNotice: Component = () => (
  <Notice title={t('common.noProject')} hint={t('common.noProjectHint')} />
)

/**
 * 尚未实现的二级入口：入口照常渲染、点击弹提示。
 * 隐藏会让页面结构与设计稿对不上，置灰则解释不了「为什么不能点」。
 */
export function comingSoon(): void {
  showToast(t('common.comingSoon'))
}
