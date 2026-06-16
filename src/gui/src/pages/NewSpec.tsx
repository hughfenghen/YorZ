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
  const [title, setTitle] = createSignal('')
  const [summary, setSummary] = createSignal('')
  const [requirement, setRequirement] = createSignal('')
  const [type, setType] = createSignal<CreateSpecBody['type']>('feat')
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  async function submit(e: Event) {
    e.preventDefault()
    setError(null)
    if (!title().trim() || !summary().trim()) {
      setError('标题与一句话概要必填')
      return
    }
    setBusy(true)
    try {
      const created = await api.createSpec({
        title: title().trim(),
        type: type(),
        summary: summary().trim(),
        requirement: requirement().trim() || undefined,
      })
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
      </header>
      <form class="form" onSubmit={submit}>
        <label>
          <span>标题</span>
          <input
            type="text"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder="例如：登录支持手机号"
            required
          />
        </label>
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
          <span>一句话概要（summary，≤200 字符）</span>
          <input
            type="text"
            value={summary()}
            maxlength={200}
            onInput={(e) => setSummary(e.currentTarget.value)}
            placeholder="供列表展示，简短描述目标"
            required
          />
        </label>
        <label>
          <span>需求描述（可选，写入 `## 背景`）</span>
          <textarea
            rows={6}
            value={requirement()}
            onInput={(e) => setRequirement(e.currentTarget.value)}
            placeholder="原始诉求 / 痛点 / 期望效果"
          />
        </label>
        {error() && <p class="error">{error()}</p>}
        <button type="submit" class="primary-action" disabled={busy()}>
          {busy() ? '创建中…' : '创建 spec'}
        </button>
      </form>
    </section>
  )
}
