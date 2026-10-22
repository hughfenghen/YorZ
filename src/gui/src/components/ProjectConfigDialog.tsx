import { createEffect, createSignal, Show, type Component } from 'solid-js'
import {
  api,
  type AgentConfig,
  type AgentDescriptor,
  type AgentModelCatalog,
  type ProjectConfig,
} from '../lib/api.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog.jsx'
import { Button } from './ui/button.jsx'
import { Input } from './ui/input.jsx'
import { SettingsSelect } from './SettingsSelect.jsx'
import { t } from '../i18n/index.js'

interface Props {
  open: boolean
  projectId: string
  projectName: string
  onClose: () => void
  /** Called with a user-facing message after a successful save. */
  onSaved?: (message: string) => void
}

const DEFAULT_SPECS_DIR = '.yorz/specs'

const BUILTIN_LABEL_KEY: Record<string, string> = {
  claude: 'projectConfig.agentClaude',
  opencode: 'projectConfig.agentOpencode',
  codex: 'projectConfig.agentCodex',
  pi: 'projectConfig.agentPi',
}

export const ProjectConfigDialog: Component<Props> = (props) => {
  const [kind, setKind] = createSignal<string>('inherit')
  const [agents, setAgents] = createSignal<AgentDescriptor[]>([])
  const [model, setModel] = createSignal('')
  const [reasoningEffort, setReasoningEffort] = createSignal('')
  const [catalog, setCatalog] = createSignal<AgentModelCatalog>({
    models: [],
    defaultReasoningEfforts: [],
  })
  const [catalogLoading, setCatalogLoading] = createSignal(false)
  const [specsDir, setSpecsDir] = createSignal(DEFAULT_SPECS_DIR)
  const [initialSpecsDir, setInitialSpecsDir] = createSignal(DEFAULT_SPECS_DIR)
  const [loading, setLoading] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let catalogRequest = 0

  createEffect(() => {
    if (!props.open) return
    setError(null)
    setLoading(true)
    void (async () => {
      try {
        // Fetch config + the agent roster together: the dropdown lists builtin
        // and external (config `customAgents`) agents from the single `/agents`
        // source rather than a hardcoded array.
        const [cfg, descriptors] = await Promise.all([
          api.getProjectConfig(props.projectId),
          api.listAgents(props.projectId).catch(() => [] as AgentDescriptor[]),
        ])
        setAgents(descriptors)
        applyConfig(cfg)
        if (cfg.agent.kind !== 'inherit') await loadCatalog(cfg.agent.kind)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  })

  function applyConfig(cfg: ProjectConfig) {
    setKind(cfg.agent.kind)
    setModel(cfg.agent.model ?? '')
    setReasoningEffort(cfg.agent.reasoningEffort ?? '')
    const dir = cfg.specsDir || DEFAULT_SPECS_DIR
    setSpecsDir(dir)
    setInitialSpecsDir(dir)
  }

  function buildAgent(): AgentConfig {
    if (kind() === 'inherit') return { kind: 'inherit' }
    return {
      kind: kind(),
      ...(model() ? { model: model() } : {}),
      ...(reasoningEffort() ? { reasoningEffort: reasoningEffort() } : {}),
    }
  }

  /** 'inherit' + every known agent id, in roster order. */
  const options = (): string[] => ['inherit', ...agents().map((a) => a.id)]

  function agentLabel(id: string): string {
    if (id === 'inherit') return t('projectConfig.inheritGlobal')
    const descriptor = agents().find((a) => a.id === id)
    if (descriptor && descriptor.source === 'external') return descriptor.displayName
    const key = BUILTIN_LABEL_KEY[id]
    return key ? t(key) : (descriptor?.displayName ?? id)
  }

  function updateKind(value: string): void {
    setKind(value)
    setModel('')
    setReasoningEffort('')
    setCatalog({ models: [], defaultReasoningEfforts: [] })
    if (value !== 'inherit') void loadCatalog(value)
  }

  function updateModel(value: string): void {
    setModel(value)
    setReasoningEffort('')
  }

  async function loadCatalog(agentKind: string): Promise<void> {
    const request = ++catalogRequest
    setCatalogLoading(true)
    try {
      const next = await api.listAgentModels(props.projectId, agentKind)
      if (request === catalogRequest) setCatalog(next)
    } catch {
      if (request === catalogRequest) setCatalog({ models: [], defaultReasoningEfforts: [] })
    } finally {
      if (request === catalogRequest) setCatalogLoading(false)
    }
  }

  const modelOptions = () => {
    const options = [
      { value: '', label: t('projectConfig.agentDefaultOption') },
      ...catalog().models.map((item) => ({ value: item.id, label: item.displayName })),
    ]
    if (model() && !options.some((item) => item.value === model())) {
      options.push({ value: model(), label: model() })
    }
    return options
  }

  const reasoningOptions = () => {
    const choices = model()
      ? (catalog().models.find((item) => item.id === model())?.reasoningEfforts ?? [])
      : catalog().defaultReasoningEfforts
    const options = [
      { value: '', label: t('projectConfig.agentDefaultOption') },
      ...choices.map((item) => ({ value: item.id, label: item.displayName })),
    ]
    if (reasoningEffort() && !options.some((item) => item.value === reasoningEffort())) {
      options.push({ value: reasoningEffort(), label: reasoningEffort() })
    }
    return options
  }

  async function submit(e: Event) {
    e.preventDefault()
    setError(null)
    const agent = buildAgent()
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
            <fieldset class="m-0 grid gap-3 border-0 p-0 sm:grid-cols-3">
              <SettingsSelect
                label={t('projectConfig.agent')}
                value={kind()}
                options={options().map((value) => ({ value, label: agentLabel(value) }))}
                disabled={busy()}
                onChange={updateKind}
              />
              <SettingsSelect
                label={t('projectConfig.model')}
                value={model()}
                options={modelOptions()}
                disabled={
                  busy() || kind() === 'inherit' || catalogLoading() || modelOptions().length <= 1
                }
                onChange={updateModel}
              />
              <SettingsSelect
                label={t('projectConfig.reasoningEffort')}
                value={reasoningEffort()}
                options={reasoningOptions()}
                disabled={
                  busy() ||
                  kind() === 'inherit' ||
                  catalogLoading() ||
                  reasoningOptions().length <= 1
                }
                onChange={setReasoningEffort}
              />
            </fieldset>

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
