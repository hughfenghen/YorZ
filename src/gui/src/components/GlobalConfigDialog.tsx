import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { api, type AgentDescriptor, type AgentModelCatalog, type GlobalConfig } from '../lib/api.js'
import { DEFAULT_GLOBAL_CONFIG, globalConfig, saveGlobalConfig } from '../lib/global-config.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog.jsx'
import { Button } from './ui/button.jsx'
import { Checkbox, CheckboxControl, CheckboxLabel } from './ui/checkbox.jsx'
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
  RadioGroupLabel,
} from './ui/radio-group.jsx'
import { SettingsSelect } from './SettingsSelect.jsx'
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  effectiveShortcuts,
  findShortcutConflicts,
  shortcutFromEvent,
  type ShortcutActionId,
  type ShortcutConfig,
} from '../lib/shortcuts.js'
import { t } from '../i18n/index.js'

interface Props {
  open: boolean
  onClose: () => void
}

type PowerInhibitMode = 'system-default' | 'prevent-display-sleep' | 'keep-system-awake'

const BUILTIN_LABEL_KEY: Record<string, string> = {
  claude: 'projectConfig.agentClaude',
  opencode: 'projectConfig.agentOpencode',
  codex: 'projectConfig.agentCodex',
  pi: 'projectConfig.agentPi',
}

export const GlobalConfigDialog: Component<Props> = (props) => {
  const [agentDefault, setAgentDefault] = createSignal<string>('claude')
  const [agents, setAgents] = createSignal<AgentDescriptor[]>([])
  const [model, setModel] = createSignal('')
  const [reasoningEffort, setReasoningEffort] = createSignal('')
  const [catalog, setCatalog] = createSignal<AgentModelCatalog>({
    models: [],
    defaultReasoningEfforts: [],
  })
  const [catalogLoading, setCatalogLoading] = createSignal(false)
  const [banner, setBanner] = createSignal(false)
  const [sound, setSound] = createSignal(false)
  const [powerMode, setPowerMode] = createSignal<PowerInhibitMode>('system-default')
  const [shortcuts, setShortcuts] = createSignal<ShortcutConfig>({})
  const [recording, setRecording] = createSignal<ShortcutActionId | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [saveStatus, setSaveStatus] = createSignal<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = createSignal<string | null>(null)
  let catalogRequest = 0
  const conflicts = createMemo(() => new Set(findShortcutConflicts(shortcuts())))
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    if (!props.open) return
    setError(null)
    clearSaveStatusTimer()
    setSaveStatus('idle')
    setLoading(true)
    void (async () => {
      try {
        // Fetch config + the agent roster together: the global-default dropdown
        // now lists builtin and global external (`customAgents`) agents from the
        // single `/agents` source rather than a hardcoded array.
        const [cfg, descriptors] = await Promise.all([
          api.getGlobalConfig(),
          api.listGlobalAgents().catch(() => [] as AgentDescriptor[]),
        ])
        applyConfig(cfg)
        setAgents(descriptors)
        await loadCatalog(cfg.agent.defaultKind)
      } catch (err) {
        setError((err as Error).message)
        applyConfig(DEFAULT_GLOBAL_CONFIG)
      } finally {
        setLoading(false)
      }
    })()
  })

  function applyConfig(cfg: GlobalConfig): void {
    setAgentDefault(cfg.agent.defaultKind)
    setModel(cfg.agent.model ?? '')
    setReasoningEffort(cfg.agent.reasoningEffort ?? '')
    setBanner(Boolean(cfg.notifications.sessionEnd.banner))
    setSound(Boolean(cfg.notifications.sessionEnd.sound))
    setPowerMode(cfg.power?.inhibitWhenRunning ?? 'system-default')
    setShortcuts(cfg.shortcuts ?? {})
    setRecording(null)
  }

  createEffect(() => {
    const action = recording()
    if (!action) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        const next = { ...shortcuts(), [action]: null }
        setShortcuts(next)
        setRecording(null)
        void persistPatch({ shortcuts: next })
        return
      }
      const binding = shortcutFromEvent(event)
      if (!binding) return
      const next = { ...shortcuts(), [action]: binding }
      setShortcuts(next)
      setRecording(null)
      void persistPatch({ shortcuts: next })
    }
    window.addEventListener('keydown', onKeyDown, true)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, true))
  })

  async function persistPatch(patch: Partial<GlobalConfig>): Promise<void> {
    setError(null)
    const nextShortcuts = patch.shortcuts ?? shortcuts()
    if (findShortcutConflicts(nextShortcuts).length > 0) {
      setError(t('globalConfig.shortcutConflict'))
      return
    }
    clearSaveStatusTimer()
    setSaveStatus('saving')
    try {
      const nextModel = patch.agent ? patch.agent.model : model() || undefined
      const nextReasoning = patch.agent
        ? patch.agent.reasoningEffort
        : reasoningEffort() || undefined
      await saveGlobalConfig({
        agent: {
          defaultKind: patch.agent?.defaultKind ?? agentDefault(),
          ...(nextModel ? { model: nextModel } : {}),
          ...(nextReasoning ? { reasoningEffort: nextReasoning } : {}),
        },
        notifications: {
          sessionEnd: {
            banner: patch.notifications?.sessionEnd.banner ?? banner(),
            sound: patch.notifications?.sessionEnd.sound ?? sound(),
          },
          // 推送开关只在移动端设置页管理，桌面端整体回写时原样保留，避免被清掉。
          push: patch.notifications?.push ?? globalConfig().notifications.push,
        },
        shortcuts: nextShortcuts,
        power: {
          inhibitWhenRunning: patch.power?.inhibitWhenRunning ?? powerMode(),
        },
        appearance: globalConfig().appearance,
        customInstructions: globalConfig().customInstructions,
      })
      setSaveStatus('saved')
      saveStatusTimer = setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveStatus('idle')
      setError((err as Error).message)
    }
  }

  function clearSaveStatusTimer(): void {
    if (!saveStatusTimer) return
    clearTimeout(saveStatusTimer)
    saveStatusTimer = undefined
  }

  onCleanup(clearSaveStatusTimer)

  /** Builtin + every external agent id, in roster order (fallback to builtins). */
  const agentOptions = (): string[] => {
    const ids = agents().map((a) => a.id)
    return ids.length > 0 ? ids : ['claude', 'opencode', 'codex', 'pi']
  }

  function agentLabel(id: string): string {
    const descriptor = agents().find((a) => a.id === id)
    if (descriptor && descriptor.source === 'external') return descriptor.displayName
    const key = BUILTIN_LABEL_KEY[id]
    return key ? t(key) : (descriptor?.displayName ?? id)
  }

  function shortcutLabel(action: ShortcutActionId): string {
    return t(`globalConfig.shortcuts.${action}`)
  }

  function powerModeLabel(mode: PowerInhibitMode): string {
    if (mode === 'prevent-display-sleep') return t('globalConfig.powerPreventDisplaySleep')
    if (mode === 'keep-system-awake') return t('globalConfig.powerKeepSystemAwake')
    return t('globalConfig.powerSystemDefault')
  }

  function shortcutValue(action: ShortcutActionId): string {
    if (recording() === action) return t('globalConfig.shortcutRecording')
    return effectiveShortcuts(shortcuts())[action]
  }

  function resetShortcut(action: ShortcutActionId): void {
    const next = { ...shortcuts(), [action]: null }
    setShortcuts(next)
    void persistPatch({ shortcuts: next })
  }

  function updateAgentDefault(kind: string): void {
    setAgentDefault(kind)
    setModel('')
    setReasoningEffort('')
    void loadCatalog(kind)
    void persistPatch({ agent: { defaultKind: kind } })
  }

  function updateModel(value: string): void {
    setModel(value)
    setReasoningEffort('')
    void persistPatch({
      agent: { defaultKind: agentDefault(), ...(value ? { model: value } : {}) },
    })
  }

  function updateReasoningEffort(value: string): void {
    setReasoningEffort(value)
    void persistPatch({
      agent: {
        defaultKind: agentDefault(),
        ...(model() ? { model: model() } : {}),
        ...(value ? { reasoningEffort: value } : {}),
      },
    })
  }

  async function loadCatalog(kind: string): Promise<void> {
    const request = ++catalogRequest
    setCatalogLoading(true)
    try {
      const next = await api.listGlobalAgentModels(kind)
      if (request === catalogRequest) setCatalog(next)
    } catch {
      if (request === catalogRequest) setCatalog({ models: [], defaultReasoningEfforts: [] })
    } finally {
      if (request === catalogRequest) setCatalogLoading(false)
    }
  }

  const modelOptions = () => {
    const options = [
      { value: '', label: t('globalConfig.agentDefaultOption') },
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
      { value: '', label: t('globalConfig.agentDefaultOption') },
      ...choices.map((item) => ({ value: item.id, label: item.displayName })),
    ]
    if (reasoningEffort() && !options.some((item) => item.value === reasoningEffort())) {
      options.push({ value: reasoningEffort(), label: reasoningEffort() })
    }
    return options
  }

  function updateBanner(value: boolean): void {
    setBanner(value)
    void persistPatch({
      notifications: {
        sessionEnd: { banner: value, sound: sound() },
        push: globalConfig().notifications.push,
      },
    })
  }

  function updateSound(value: boolean): void {
    setSound(value)
    void persistPatch({
      notifications: {
        sessionEnd: { banner: banner(), sound: value },
        push: globalConfig().notifications.push,
      },
    })
  }

  function updatePowerMode(mode: PowerInhibitMode): void {
    setPowerMode(mode)
    void persistPatch({ power: { inhibitWhenRunning: mode } })
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent class="max-w-[560px]">
        <DialogHeader>
          <DialogTitle class="flex items-baseline gap-2">
            <span>{t('globalConfig.title')}</span>
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
          fallback={<p class="text-muted-foreground">{t('common.loading')}</p>}
        >
          <div class="flex flex-col gap-4">
            <fieldset class="m-0 grid gap-3 border-0 p-0 sm:grid-cols-3">
              <SettingsSelect
                label={t('globalConfig.agentDefault')}
                value={agentDefault()}
                options={agentOptions().map((kind) => ({ value: kind, label: agentLabel(kind) }))}
                onChange={updateAgentDefault}
              />
              <SettingsSelect
                label={t('globalConfig.model')}
                value={model()}
                options={modelOptions()}
                disabled={catalogLoading() || modelOptions().length <= 1}
                onChange={updateModel}
              />
              <SettingsSelect
                label={t('globalConfig.reasoningEffort')}
                value={reasoningEffort()}
                options={reasoningOptions()}
                disabled={catalogLoading() || reasoningOptions().length <= 1}
                onChange={updateReasoningEffort}
              />
            </fieldset>

            <fieldset class="m-0 flex flex-col gap-3 border-0 p-0">
              <legend class="font-medium">{t('globalConfig.sessionEnd')}</legend>
              <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Checkbox
                  checked={banner()}
                  onChange={updateBanner}
                  class="flex items-center gap-2"
                >
                  <CheckboxControl />
                  <CheckboxLabel>{t('globalConfig.banner')}</CheckboxLabel>
                </Checkbox>
                <Checkbox checked={sound()} onChange={updateSound} class="flex items-center gap-2">
                  <CheckboxControl />
                  <CheckboxLabel>{t('globalConfig.sound')}</CheckboxLabel>
                </Checkbox>
              </div>
            </fieldset>

            <RadioGroup
              class="m-0 flex flex-wrap gap-2 border-0 p-0"
              value={powerMode()}
              onChange={(v) => updatePowerMode(v as PowerInhibitMode)}
            >
              <RadioGroupLabel class="mb-1.5 w-full font-medium">
                {t('globalConfig.powerTitle')}
              </RadioGroupLabel>
              {(['system-default', 'prevent-display-sleep', 'keep-system-awake'] as const).map(
                (mode) => (
                  <RadioGroupItem value={mode} class="flex items-center gap-1.5">
                    <RadioGroupItemInput />
                    <RadioGroupItemControl />
                    <RadioGroupItemLabel class="cursor-pointer">
                      {powerModeLabel(mode)}
                    </RadioGroupItemLabel>
                  </RadioGroupItem>
                ),
              )}
            </RadioGroup>

            <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
              <legend class="font-medium">{t('globalConfig.shortcutsTitle')}</legend>
              <div class="flex flex-col gap-2">
                <For each={SHORTCUT_ACTIONS}>
                  {(action) => (
                    <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border p-2">
                      <div class="min-w-0">
                        <p class="m-0 font-medium">{shortcutLabel(action)}</p>
                        <p
                          class={`m-0 font-mono text-sm ${
                            conflicts().has(action) ? 'text-destructive' : 'text-muted-foreground'
                          }`}
                        >
                          {shortcutValue(action)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRecording(action)}
                      >
                        {recording() === action
                          ? t('globalConfig.shortcutRecordingButton')
                          : t('globalConfig.shortcutRecord')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => resetShortcut(action)}
                        disabled={shortcutValue(action) === DEFAULT_SHORTCUTS[action]}
                      >
                        {t('globalConfig.shortcutReset')}
                      </Button>
                    </div>
                  )}
                </For>
              </div>
              <Show when={conflicts().size > 0}>
                <p class="m-0 text-sm text-destructive">{t('globalConfig.shortcutConflict')}</p>
              </Show>
            </fieldset>

            {error() && <p class="text-destructive">{error()}</p>}
          </div>
        </Show>
      </DialogContent>
    </Dialog>
  )
}
