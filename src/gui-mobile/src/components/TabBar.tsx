import { For, type Component } from 'solid-js'
import { A, useLocation } from '@solidjs/router'
import { Blocks, FileText, FolderGit2, MessagesSquare } from 'lucide-solid'
import { cn } from '@/lib/cn'
import { stripRouterBase } from '@/lib/routes'
import { t } from '@/i18n/index.js'

/**
 * 底部主导航。移动端的一级导航放底部而不是顶部：单手握持时拇指够得到的是屏幕下缘，
 * 顶部只留标题与上下文动作（见 TopBar）。
 *
 * 图标按「语义贴合该 tab 的内容」选取，全部来自 lucide-solid：
 * 三套视觉主题（terminal / graphite / paper）只改配色不改形状，
 * 没有让图标随主题联动的承载物，自绘一套只会多出维护成本。
 *
 * 四等分后单格约占 25% 宽，在最窄的 320px 设备上仍有 80px，
 * 远高于 44pt 的最小触控目标；h-14 不变。
 * pb-safe 让手势条区域由容器自己吃掉，图标不会压在 Home Indicator 上。
 */
const TABS = [
  { href: '/', labelKey: 'nav.sessions', icon: MessagesSquare, end: true },
  { href: '/specs', labelKey: 'nav.specs', icon: FileText, end: false },
  { href: '/ext', labelKey: 'nav.ext', icon: Blocks, end: false },
  { href: '/projects', labelKey: 'nav.projects', icon: FolderGit2, end: false },
] as const

export const TabBar: Component = () => {
  const location = useLocation()

  // A 组件自带 activeClass，但这里要同时给图标和文字上色，直接自己判定更直观。
  // `/` 必须精确匹配，否则它会对所有路径成立、四个 tab 同时高亮。
  //
  // 必须先 stripRouterBase：pathname 带着 `/m` 前缀，直接和裸 href 比对时
  // `/m` !== `/`、`'/m/specs'.startsWith('/specs')` 也是 false，四个 tab 会全都不亮。
  // 与 isTabRoute 读同一份剥离规则，避免「导航栏在、高亮却没跟上」。
  const isActive = (href: string, end: boolean) => {
    const path = stripRouterBase(location.pathname)
    return end ? path === href : path.startsWith(href)
  }

  return (
    <nav
      class="shrink-0 border-t-[0.5px] border-border bg-card px-safe pb-safe"
      aria-label={t('nav.sessions')}
    >
      <ul class="flex items-stretch justify-around">
        <For each={TABS}>
          {(tab) => (
            <li class="flex-1">
              <A
                href={tab.href}
                class={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[0.68rem] transition-colors',
                  // 激活态同时切颜色与字重：0.68rem 的标签只靠色相区分，强光下
                  // 很难一眼读出「我在哪一页」。取 600 而不是 700——这个字号上
                  // 700 的笔画会糊在一起，也压过 lucide 图标 2px 的线宽。
                  isActive(tab.href, tab.end)
                    ? 'font-semibold text-primary'
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
