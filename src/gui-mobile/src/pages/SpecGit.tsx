import { createResource, type Component } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { api } from '@shared/api/index.js'
import { specCommitMessage } from '@shared/lib/spec-meta.js'
import { GitPanel } from '@/components/GitPanel.jsx'
import { activeProjectId } from '@/lib/active-project.js'

/**
 * spec 作用域的 git 三级页（`/specs/:id/git`）。
 *
 * 与桌面 `SpecReview` 同构：交互全在 `GitPanel` 里，这个壳只负责补上 spec
 * 上下文——返回目标、Agent 派发所需的 specId，以及从 summary 算出的默认
 * commit message。spec 是异步 resource，预填因此会晚一拍到达；面板里的
 * 采纳闸保证它不会覆盖用户已经敲进去的内容。
 */
export const SpecGit: Component = () => {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [spec] = createResource(
    () => {
      const pid = activeProjectId()
      return pid ? ([pid, params.id] as const) : null
    },
    ([pid, id]) => api.getSpec(pid, id),
  )

  return (
    <GitPanel
      title={params.id}
      onBack={() => navigate(`/specs/${encodeURIComponent(params.id)}`)}
      specId={() => params.id}
      initialMessage={() => specCommitMessage(params.id, spec()?.frontmatter.summary)}
    />
  )
}
