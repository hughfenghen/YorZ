import { For, Show, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Check, MoreHorizontal } from 'lucide-solid'
import { displayProjectName, type ProjectListItem } from '@shared/api/project.js'
import { Page } from '@/components/Page.jsx'
import { ErrorNotice, LoadingNotice, Notice } from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import {
  activeProjectId,
  projects,
  refetchProjects,
  setActiveProjectId,
} from '@/lib/active-project.js'
import { t } from '@/i18n/index.js'

/**
 * Tab4 项目：移动端唯一的「活动项目」切换入口。
 * 整行点击 = 设为活动项目（Sessions / Specs / 扩展 三个 tab 都读它）；
 * 行尾省略号进项目设置，顶栏省略号进全局设置。
 *
 * **不提供添加 / 删除项目**：`POST /api/projects` 要求传绝对路径，手机上无从选择目录；
 * `DELETE` 是不可逆的破坏性操作，不适合放在只有单指点击的场景里。
 */
export const Projects: Component = () => {
  const navigate = useNavigate()

  const select = (p: ProjectListItem) => {
    if (p.id === activeProjectId()) return
    setActiveProjectId(p.id)
    showToast(t('projects.switched'))
  }

  return (
    <Page
      title={t('projects.title')}
      padded={false}
      actions={
        <button
          type="button"
          class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
          aria-label={t('projects.globalSettings')}
          onClick={() => navigate('/settings/global')}
        >
          <MoreHorizontal size={20} aria-hidden="true" />
        </button>
      }
    >
      <Show when={!projects.loading} fallback={<LoadingNotice />}>
        <Show
          when={!projects.error}
          fallback={<ErrorNotice error={projects.error} onRetry={() => void refetchProjects()} />}
        >
          <Show
            when={(projects() ?? []).length > 0}
            fallback={
              <Notice title={t('common.emptyProjects')} hint={t('common.emptyProjectsHint')} />
            }
          >
            {/* border-b 补末行的边框：项目通常只有几条，末行下方是整屏空白，
                只靠 divide-y 会让列表看起来像被裁断。首行上边框不补——列表贴着
                顶栏滚动，那条 border-t 会和顶栏的 border-b 叠成 2px 粗线。
                底色与扩展页列表同口径：卡片色列表浮在稍深的页面底色上 */}
            <ul class="divide-y divide-border border-b border-border bg-card">
              <For each={projects()}>
                {(p) => (
                  <li class="flex items-center pr-4 active:bg-accent">
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
                      onClick={() => select(p)}
                      aria-current={p.id === activeProjectId() ? 'true' : undefined}
                    >
                      {/* 勾的槽位固定宽度：未选中时留空而不是不渲染，否则项目名会左右跳 */}
                      <span class="flex w-5 shrink-0 justify-center">
                        <Show when={p.id === activeProjectId()}>
                          <Check size={18} class="text-primary" aria-hidden="true" />
                        </Show>
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm">{displayProjectName(p)}</span>
                        {/* 路径从头部截断，见 app.css 的 .truncate-start */}
                        <span class="truncate-start mt-0.5 block text-xs text-muted-foreground">
                          {p.path}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      // -mr-2 与顶栏省略号同一负边距口径（容器 px-4 / pr-4 + 按钮 -mr-2），
                      // 两枚图标中心因此都落在距屏幕右缘 30px，肉眼在同一竖线上
                      class="tap-target flex shrink-0 items-center justify-center text-muted-foreground active:opacity-60"
                      aria-label={t('projects.projectSettings')}
                      onClick={(e) => {
                        // 不阻止冒泡的话，点设置会顺带把活动项目切成这一行
                        e.stopPropagation()
                        setActiveProjectId(p.id)
                        navigate('/settings/project')
                      }}
                    >
                      <MoreHorizontal size={18} aria-hidden="true" />
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>
    </Page>
  )
}
