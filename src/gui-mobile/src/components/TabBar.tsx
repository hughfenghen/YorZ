import { For, type Component } from 'solid-js'
import { A, useLocation } from '@solidjs/router'
import { FileText, Home, Settings } from 'lucide-solid'
import { cn } from '@/lib/cn'
import { t } from '@/i18n/index.js'

/**
 * 底部主导航。移动端的一级导航放底部而不是顶部：单手握持时拇指够得到的是屏幕下缘，
 * 顶部只留标题与上下文动作（见 TopBar）。
 *
 * pb-safe 让手势条区域由容器自己吃掉，图标不会压在 Home Indicator 上。
 */
const TABS = [
  { href: '/', labelKey: 'nav.home', icon: Home, end: true },
  { href: '/specs', labelKey: 'nav.specs', icon: FileText, end: false },
  { href: '/settings', labelKey: 'nav.settings', icon: Settings, end: false },
] as const

export const TabBar: Component = () => {
  const location = useLocation()

  // A 组件自带 activeClass，但这里要同时给图标和文字上色，直接自己判定更直观
  const isActive = (href: string, end: boolean) =>
    end ? location.pathname === href : location.pathname.startsWith(href)

  return (
    <nav class="shrink-0 border-t border-border bg-card px-safe pb-safe" aria-label={t('nav.home')}>
      <ul class="flex items-stretch justify-around">
        <For each={TABS}>
          {(tab) => (
            <li class="flex-1">
              <A
                href={tab.href}
                class={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[0.68rem] transition-colors',
                  isActive(tab.href, tab.end)
                    ? 'text-primary'
                    : 'text-muted-foreground active:text-foreground',
                )}
                aria-current={isActive(tab.href, tab.end) ? 'page' : undefined}
              >
                <tab.icon size={20} aria-hidden="true" />
                <span>{t(tab.labelKey)}</span>
              </A>
            </li>
          )}
        </For>
      </ul>
    </nav>
  )
}
