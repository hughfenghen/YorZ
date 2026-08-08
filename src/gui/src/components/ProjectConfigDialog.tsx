import { createEffect, createSignal, Show, type Component } from 'solid-js'
import { api, type AgentConfig, type ProjectConfig } from '../lib/api.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog.jsx'
import { Button } from './ui/button.jsx'
import { Input } from './ui/input.jsx'
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
  RadioGroupLabel,
} from './ui/radio-group.jsx'
import { t } from '../i18n/index.js'

interface Props {
  open: boolean
  projectId: string
  projectName: string
  onClose: () => void
  /** Called with a user-facing message after a successful save. */
  onSaved?: (message: string) => void
}

type AgentKind = 'inherit' | 'claude' | 'opencode' | 'codex' | 'custom'

const DEFAULT_SPECS_DIR = '.yorz/specs'

export const ProjectConfigDialog: Component<Props> = (props) => {
  const [kind, setKind] = createSignal<AgentKind>('inherit')
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
    if (k === 'inherit') return { kind: 'inherit' }
    if (k === 'claude') return { kind: 'claude' }
    if (k === 'opencode') return { kind: 'opencode' }
    if (k === 'codex') return { kind: 'codex' }
    const cmd = customCmd().trim()
    if (!cmd) return { error: t('projectConfig.cmdRequired') }
    return { kind: 'custom', cmd, args: parseArgs(customArgs()) }
  }

  function agentLabel(k: AgentKind): string {
    if (k === 'inherit') return t('projectConfig.inheritGlobal')
    if (k === 'custom') return t('projectConfig.custom')
    if (k === 'codex') return t('projectConfig.agentCodex')
    if (k === 'opencode') return t('projectConfig.agentOpencode')
    return t('projectConfig.agentClaude')
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
      setError(t('projectConfig.invalidPath'))
      return
    }
    setBusy(true)
    try {
      await api.updateProjectConfig(props.projectId, { agent, specsDir: dir })
      let msg = t('projectConfig.saved')
      if (dir !== initialSpecsDir()) {
        msg += t('projectConfig.oldSpecsHint')
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
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent class="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {t('projectConfig.title')} · {props.projectName}
          </DialogTitle>
        </DialogHeader>

        <Show
          when={!loading()}
          fallback={<p class=" text-muted-foreground">{t('common.loading')}</p>}
        >
          <form onSubmit={submit} class="flex flex-col gap-4">
            <RadioGroup
              class="m-0 flex flex-wrap gap-2 border-0 p-0"
              value={kind()}
              onChange={(v) => setKind(v as AgentKind)}
              disabled={busy()}
            >
              <RadioGroupLabel class="mb-1.5 w-full font-medium">
                {t('projectConfig.agent')}
              </RadioGroupLabel>
              {(['inherit', 'claude', 'opencode', 'codex', 'custom'] as const).map((k) => (
                <RadioGroupItem value={k} class="flex items-center gap-1.5">
                  <RadioGroupItemInput />
                  <RadioGroupItemControl />
                  <RadioGroupItemLabel class="cursor-pointer">{agentLabel(k)}</RadioGroupItemLabel>
                </RadioGroupItem>
              ))}
            </RadioGroup>

            <Show when={kind() === 'custom'}>
              <label class="flex flex-col gap-1 font-medium">
                <span>{t('projectConfig.cmd')}</span>
                <Input
                  type="text"
                  value={customCmd()}
                  onInput={(e) => setCustomCmd(e.currentTarget.value)}
                  placeholder={t('projectConfig.cmdPlaceholder')}
                  disabled={busy()}
                />
              </label>
              <label class="flex flex-col gap-1 font-medium">
                <span>{t('projectConfig.args')}</span>
                <Input
                  type="text"
                  value={customArgs()}
                  onInput={(e) => setCustomArgs(e.currentTarget.value)}
                  placeholder="--flag value"
                  disabled={busy()}
                />
              </label>
            </Show>

            <label class="flex flex-col gap-1 font-medium">
              <span>{t('projectConfig.specsDir')}</span>
              <Input
                type="text"
                value={specsDir()}
                onInput={(e) => setSpecsDir(e.currentTarget.value)}
                placeholder={DEFAULT_SPECS_DIR}
                disabled={busy()}
              />
              <span class="text-sm text-muted-foreground">{t('projectConfig.specsDirHint')}</span>
            </label>

            {error() && <p class=" text-destructive">{error()}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={props.onClose} disabled={busy()}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy()}>
                {busy() ? t('common.saving') : t('projectConfig.save')}
              </Button>
            </DialogFooter>
          </form>
        </Show>
      </DialogContent>
    </Dialog>
  )
}
