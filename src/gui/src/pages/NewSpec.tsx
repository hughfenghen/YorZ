import { createSignal, onCleanup, Show, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { api, type CreateSpecBody } from '../lib/api.js'
import { subscribeSpecsList } from '../lib/sse.js'
import { agentTasks } from '../lib/agent-tasks.js'

const TYPES: { value: CreateSpecBody['type']; label: string; hint: string }[] = [
  { value: 'feat', label: 'feat', hint: '新功能' },
  { value: 'refct', label: 'refct', hint: '重构 / 抽取' },
  { value: 'fix', label: 'fix', hint: '修复缺陷' },
]

type Phase = 'idle' | 'creating' | 'failed'

export const NewSpec: Component = () => {
  const navigate = useNavigate()
  const [content, setContent] = createSignal('')
  const [type, setType] = createSignal<CreateSpecBody['type']>('feat')
  const [error, setError] = createSignal<string | null>(null)
  const [phase, setPhase] = createSignal<Phase>('idle')

  let cleanupList: (() => void) | null = null
  let baselineIds: Set<string> = new Set()
  let activeRunId: string | null = null
  let navigated = false

  onCleanup(() => {
    cleanupList?.()
  })

  async function pollForNewSpec() {
    if (navigated) return
    try {
      const list = await api.listSpecs()
      const fresh = list.find((s) => !baselineIds.has(s.id))
      if (fresh) {
        navigated = true
        const runId = activeRunId
        cleanupList?.()
        cleanupList = null
        const target =
          `/specs/${encodeURIComponent(fresh.id)}` +
          (runId ? `?runId=${encodeURIComponent(runId)}` : '')
        navigate(target)
      }
    } catch {
      // ignore; will retry on next list-updated event
    }
  }

  async function submit(e: Event) {
    e.preventDefault()
    setError(null)
    const text = content().trim()
    if (text.length < 5) {
      setError('请至少输入 5 个字符的需求描述')
      return
    }
    setPhase('creating')
    navigated = false
    try {
      const before = await api.listSpecs()
      baselineIds = new Set(before.map((s) => s.id))

      const resp = await api.createSpec({ type: type(), requirement: text })
      if ('draft' in resp && resp.draft) {
        activeRunId = resp.runId
        // Register with the global Agent dock; the panel persists across navigation.
        agentTasks.start({
          runId: resp.runId,
          mode: 'skill-run',
          specId: `__draft__-${resp.runId}`,
          specTitle: '（新建 spec 中）',
          source: 'draft',
        })
        cleanupList = subscribeSpecsList(() => {
          void pollForNewSpec()
        })
        void pollForNewSpec()
      } else if ('id' in resp) {
        // Legacy synchronous path (title provided).
        navigate(`/specs/${encodeURIComponent(resp.id)}`)
      }
    } catch (err) {
      setError((err as Error).message)
      setPhase('failed')
    }
  }

  return (
    <section class="page">
      <header class="page-head">
        <h1>新建 spec</h1>
        <p class="muted">
          只需选择类型与录入需求内容；文件名、概要、初始骨架由 Agent 根据需求生成，Agent
          创建完文档后会自动进入 plan 阶段。
        </p>
      </header>
      <Show when={phase() === 'idle' || phase() === 'failed'}>
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
          <button type="submit" class="primary-action">
            创建并启动 Agent
          </button>
        </form>
      </Show>
      <Show when={phase() === 'creating'}>
        <section class="run-log">
          <p class="muted">
            Agent 正在创建 spec 文档…可在右下角 Agent 面板查看流式输出，文档落地后将自动跳转。
          </p>
        </section>
      </Show>
    </section>
  )
}
