import { createEffect, createSignal, onCleanup, Show, type Component } from 'solid-js'
import { createLatestMutationQueue } from '@shared/lib/latest-mutation-queue.js'
import {
  api,
  type AgentConfig,
  type AgentDescriptor,
  type AgentModelCatalog,
  type ProjectConfig,
} from '../lib/api.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog.jsx'
import { Input } from './ui/input.jsx'
import { AgentSettings } from './AgentSettings.jsx'
import { t } from '../i18n/index.js'

interface Props {
  open: boolean
  projectId: string
  projectName: string
  onClose: () => void
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
  const [saveStatus, setSaveStatus] = createSignal<'idle' | 'saving' | 'saved'>('idle')
  const [showOldSpecsHint, setShowOldSpecsHint] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let catalogRequest = 0
  let configRequest = 0
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined
  let lastRequestedSpecsDir = DEFAULT_SPECS_DIR
  const configSaveQueue = createLatestMutationQueue()

  createEffect(() => {
    const request = ++configRequest
    if (!props.open) return
    setError(null)
    clearSaveStatusTimer()
    setSaveStatus('idle')
    setShowOldSpecsHint(false)
    setLoading(true)
    void (async () => {
      try {
        await configSaveQueue.whenIdle()
        if (request !== configRequest || !props.open) return
        // Fetch config + the agent roster together: the dropdown lists builtin
        // and external (config `customAgents`) agents from the single `/agents`
        // source rather than a hardcoded array.
        const [cfg, descriptors] = await Promise.all([
          api.getProjectConfig(props.projectId),
          api.listAgents(props.projectId).catch(() => [] as AgentDescriptor[]),
        ])
        if (request !== configRequest || !props.open) return
        setAgents(descriptors)
        applyConfig(cfg)
        if (cfg.agent.kind !== 'inherit') void loadCatalog(cfg.agent.kind)
      } catch (err) {
        if (request !== configRequest || !props.open) return
        setError((err as Error).message)
      } finally {
        if (request === configRequest) setLoading(false)
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
    lastRequestedSpecsDir = dir
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
    void persistConfig({ kind: value }, lastRequestedSpecsDir)
  }

  function updateModel(value: string): void {
    setModel(value)
    setReasoningEffort('')
    void persistConfig(
      {
        kind: kind(),
        ...(value ? { model: value } : {}),
      },
      lastRequestedSpecsDir,
    )
  }

  function updateReasoningEffort(value: string): void {
    setReasoningEffort(value)
    void persistConfig(
      {
        kind: kind(),
        ...(model() ? { model: model() } : {}),
        ...(value ? { reasoningEffort: value } : {}),
      },
      lastRequestedSpecsDir,
    )
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

  async function persistConfig(agent: AgentConfig, dirValue: string): Promise<void> {
    setError(null)
    setShowOldSpecsHint(false)
    clearSaveStatusTimer()
    setSaveStatus('saving')
    await configSaveQueue.enqueue({
      task: () => api.updateProjectConfig(props.projectId, { agent, specsDir: dirValue }),
      onLatestSuccess: (saved) => {
        const directoryChanged = saved.config.specsDir !== initialSpecsDir()
        setInitialSpecsDir(saved.config.specsDir)
        lastRequestedSpecsDir = saved.config.specsDir
        if ((specsDir().trim() || DEFAULT_SPECS_DIR) === dirValue) {
          setSpecsDir(saved.config.specsDir)
        }
        setShowOldSpecsHint(directoryChanged)
        setSaveStatus('saved')
        saveStatusTimer = setTimeout(() => setSaveStatus('idle'), 2000)
      },
      onLatestError: (err) => {
        if (lastRequestedSpecsDir === dirValue) lastRequestedSpecsDir = initialSpecsDir()
        setSaveStatus('idle')
        setError((err as Error).message)
      },
    })
  }

  function commitSpecsDir(): void {
    const dir = specsDir().trim() || DEFAULT_SPECS_DIR
    if (dir.split(/[\\/]/).some((seg) => seg === '..')) {
      setError(t('projectConfig.invalidPath'))
      return
    }
    setSpecsDir(dir)
    if (dir === lastRequestedSpecsDir) return
    lastRequestedSpecsDir = dir
    void persistConfig(buildAgent(), dir)
  }

  function closeDialog(): void {
    commitSpecsDir()
    props.onClose()
  }

  function clearSaveStatusTimer(): void {
    if (!saveStatusTimer) return
    clearTimeout(saveStatusTimer)
    saveStatusTimer = undefined
  }

  onCleanup(clearSaveStatusTimer)

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent class="max-w-[480px]">
        <DialogHeader>
          <DialogTitle class="flex items-baseline gap-2">
            <span>
              {t('projectConfig.title')} · {props.projectName}
            </span>
            <Show when={saveStatus() !== 'idle'}>
              <span class="text-xs font-normal text-muted-foreground">
                {saveStatus() === 'saving'
                  ? t('globalConfig.saveStatusSaving')
                  : t('globalConfig.saveStatusSaved')}
              </span>
            </Show>
          </DialogTitle>
        </DialogHeader>

        <Show
          when={!loading()}
          fallback={<p class=" text-muted-foreground">{t('common.loading')}</p>}
        >
          <div class="flex flex-col gap-4">
            <fieldset class="m-0 grid gap-3 border-0 p-0 sm:grid-cols-3">
              <AgentSettings
                label={t('projectConfig.agent')}
                value={kind()}
                options={options().map((value) => ({ value, label: agentLabel(value) }))}
                onChange={updateKind}
              />
              <AgentSettings
                label={t('projectConfig.model')}
                value={model()}
                options={modelOptions()}
                searchable={catalog().models.length > 10}
                filterPlaceholder={t('common.filterOptions')}
                emptyText={t('common.noMatchingOptions')}
                disabled={kind() === 'inherit' || catalogLoading() || modelOptions().length <= 1}
                onChange={updateModel}
              />
              <AgentSettings
                label={t('projectConfig.reasoningEffort')}
                value={reasoningEffort()}
                options={reasoningOptions()}
                disabled={
                  kind() === 'inherit' || catalogLoading() || reasoningOptions().length <= 1
                }
                onChange={updateReasoningEffort}
              />
            </fieldset>

            <label class="flex flex-col gap-1 font-medium">
              <span>{t('projectConfig.specsDir')}</span>
              <Input
                type="text"
                value={specsDir()}
                onInput={(e) => setSpecsDir(e.currentTarget.value)}
                onBlur={commitSpecsDir}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                placeholder={DEFAULT_SPECS_DIR}
              />
              <span class="text-sm text-muted-foreground">{t('projectConfig.specsDirHint')}</span>
              <Show when={showOldSpecsHint()}>
                <span class="text-sm text-muted-foreground">{t('projectConfig.oldSpecsHint')}</span>
              </Show>
            </label>

            {error() && <p class=" text-destructive">{error()}</p>}
          </div>
        </Show>
      </DialogContent>
    </Dialog>
  )
}
