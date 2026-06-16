import { createSignal, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { api, type CreateSpecBody } from '../lib/api.js'

const TYPES: { value: CreateSpecBody['type']; label: string; hint: string }[] = [
  { value: 'feat', label: 'feat', hint: '新功能' },
  { value: 'refct', label: 'refct', hint: '重构 / 抽取' },
  { value: 'fix', label: 'fix', hint: '修复缺陷' },
]

export const NewSpec: Component = () => {
  const navigate = useNavigate()
  const [content, setContent] = createSignal('')
  const [type, setType] = createSignal<CreateSpecBody['type']>('feat')
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  async function submit(e: Event) {
    e.preventDefault()
    setError(null)
    const text = content().trim()
    if (text.length < 5) {
      setError('请至少输入 5 个字符的需求描述')
      return
    }
    setBusy(true)
    try {
      const created = await api.createSpec({ type: type(), requirement: text })
      try {
        await api.runAgent(created.id)
      } catch (err) {
        // surface but still navigate so user sees the new spec
        console.warn('runAgent after create failed:', err)
      }
      navigate(`/specs/${encodeURIComponent(created.id)}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="page">
      <header class="page-head">
        <h1>新建 spec</h1>
        <p class="muted">只需选择类型与录入需求内容；标题、概要将由 Agent 在 plan 阶段自动补全。</p>
      </header>
      <form class="form" onSubmit={submit}>
        <fieldset class="type-group">
          <legend>类型</legend>
          {TYPES.map((t) => (
            <label class={`type-pill ${type() === t.value ? 'active' : ''}`}>
              <input
                type="radio"
                name="type"
                value={t.value}
                checked={type() === t.value}
                onChange={() => setType(t.value)}
              />
              <strong>{t.label}</strong>
              <span class="muted">{t.hint}</span>
            </label>
          ))}
        </fieldset>
        <label>
          <span>需求内容</span>
          <textarea
            rows={10}
            value={content()}
            onInput={(e) => setContent(e.currentTarget.value)}
            placeholder="原始诉求、痛点、期望效果、关联文档/模块（可使用 @ 引用）"
            required
            autofocus
          />
        </label>
        {error() && <p class="error">{error()}</p>}
        <button type="submit" class="primary-action" disabled={busy()}>
          {busy() ? '创建并启动 Agent…' : '创建并启动 Agent'}
        </button>
      </form>
    </section>
  )
}
