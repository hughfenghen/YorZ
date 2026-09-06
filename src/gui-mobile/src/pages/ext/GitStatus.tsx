import type { Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { GitPanel } from '@/components/GitPanel.jsx'
import { t } from '@/i18n/index.js'

/**
 * 扩展二级页：Git 状态。
 *
 * 面板本体在 `components/GitPanel`，与 spec 作用域的 `pages/SpecGit` 共用。
 * 这里不传 `specId`，Agent 派发模式因此整段不渲染——从扩展页进来没有 spec
 * 上下文，`api.gitOp` 无从调起，桌面端在无 specId 时同样不渲染那一段。
 */
export const GitStatus: Component = () => {
  const navigate = useNavigate()
  return <GitPanel title={t('git.title')} onBack={() => navigate('/ext')} />
}
