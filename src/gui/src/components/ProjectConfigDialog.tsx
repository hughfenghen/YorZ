import { createEffect, createSignal, onCleanup, Show, type Component } from 'solid-js'
import { api, type AgentConfig, type ProjectConfig } from '../lib/api.js'

interface Props {
  open: boolean
  projectId: string
  projectName: string
  onClose: () => void
  /** Called with a user-facing message after a successful save. */
  onSaved?: (message: string) => void
}

type AgentKind = 'claude' | 'opencode' | 'codex' | 'custom'

const KIND_LABEL: Record<AgentKind, string> = {
  claude: 'ClaudeCode',
  opencode: 'OpenCode',
  codex: 'Codex',
  custom: '自定义',
}

const DEFAULT_SPECS_DIR = '.yorz/specs'

export const ProjectConfigDialog: Component<Props> = (props) => {
  const [kind, setKind] = createSignal<AgentKind>('claude')
  const [customCmd, setCustomCmd] = createSignal('')
  const [customArgs, setCustomArgs] = createSignal('')
  const [specsDir, setSpecsDir] = createSignal(DEFAULT_SPECS_DIR)
  const [initialSpecsDir, setInitialSpecsDir] = createSignal(DEFAULT_SPECS_DIR)
  const [loading, setLoading] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    if (!props.open) return
    setError(null)
    setLoading(true)
    void (async () => {
      try {
        const cfg = await api.getProjectConfig(props.projectId)
        applyConfig(cfg)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  })

  createEffect(() => {
    if (!props.open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        props.onClose()
      }
    }
    window.addEventListener('keydown', handler)
    onCleanup(() => window.removeEventListener('keydown', handler))
  })

  function applyConfig(cfg: ProjectConfig) {
    setKind(cfg.agent.kind)
    if (cfg.agent.kind === 'custom') {
      setCustomCmd(cfg.agent.cmd)
      setCustomArgs(cfg.agent.args.join(' '))
    } else {
      setCustomCmd('')
      setCustomArgs('')
    }
    const dir = cfg.specsDir || DEFAULT_SPECS_DIR
    setSpecsDir(dir)
    setInitialSpecsDir(dir)
  }

  function parseArgs(raw: string): string[] {
    return raw
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  function buildAgent(): AgentConfig | { error: string } {
    const k = kind()
    if (k === 'claude') return { kind: 'claude' }
    if (k === 'opencode') return { kind: 'opencode' }
    if (k === 'codex') return { kind: 'codex' }
    const cmd = customCmd().trim()
    if (!cmd) return { error: '自定义命令的 cmd 不能为空' }
    return { kind: 'custom', cmd, args: parseArgs(customArgs()) }
  }

  async function submit(e: Event) {
    e.preventDefault()
    setError(null)
    const agent = buildAgent()
    if ('error' in agent) {
      setError(agent.error)
      return
    }
    const dir = specsDir().trim() || DEFAULT_SPECS_DIR
    if (dir.split(/[\\/]/).some((seg) => seg === '..')) {
      setError('spec 目录不能包含 ".." 段')
      return
    }
    setBusy(true)
    try {
      await api.updateProjectConfig(props.projectId, { agent, specsDir: dir })
      let msg = '配置已保存'
      if (dir !== initialSpecsDir()) {
        msg += '。旧 spec 仍在原目录，请手工迁移'
      }
      props.onSaved?.(msg)
      props.onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={props.open}>
      <div class="project-config-backdrop" onMouseDown={props.onClose}>
        <div
          class="project-config-dialog"
          role="dialog"
          aria-label={`项目配置 · ${props.projectName}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header>
            <strong>项目配置 · {props.projectName}</strong>
          </header>

          <Show when={!loading()} fallback={<p class="muted">加载中…</p>}>
            <form onSubmit={submit}>
              <fieldset class="kind-group">
                <legend>Agent</legend>
                {(['claude', 'opencode', 'codex', 'custom'] as const).map((k) => (
                  <label class="kind-option">
                    <input
                      type="radio"
                      name="project-config-agent"
                      value={k}
                      checked={kind() === k}
                      onChange={() => setKind(k)}
                      disabled={busy()}
                    />
                    <span>{KIND_LABEL[k]}</span>
                  </label>
                ))}
              </fieldset>

              <Show when={kind() === 'custom'}>
                <label class="field">
                  <span>命令 (cmd)</span>
                  <input
                    type="text"
                    value={customCmd()}
                    onInput={(e) => setCustomCmd(e.currentTarget.value)}
                    placeholder="例如：/usr/local/bin/my-agent"
                    disabled={busy()}
                  />
                </label>
                <label class="field">
                  <span>参数 (args，空格分隔)</span>
                  <input
                    type="text"
                    value={customArgs()}
                    onInput={(e) => setCustomArgs(e.currentTarget.value)}
                    placeholder="--flag value"
                    disabled={busy()}
                  />
                </label>
              </Show>

              <label class="field">
                <span>spec 文档目录</span>
                <input
                  type="text"
                  value={specsDir()}
                  onInput={(e) => setSpecsDir(e.currentTarget.value)}
                  placeholder={DEFAULT_SPECS_DIR}
                  disabled={busy()}
                />
                <small class="muted">相对项目根路径，不存在时会自动创建</small>
              </label>

              {error() && <p class="error">{error()}</p>}

              <div class="actions">
                <button type="button" onClick={props.onClose} disabled={busy()}>
                  取消
                </button>
                <button type="submit" class="primary-action" disabled={busy()}>
                  {busy() ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </Show>
        </div>
      </div>
    </Show>
  )
}
