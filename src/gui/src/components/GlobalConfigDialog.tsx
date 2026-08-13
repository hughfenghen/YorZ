import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { api, type GlobalConfig } from '../lib/api.js'
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

type GlobalAgentKind = 'claude' | 'opencode' | 'codex'
type PowerInhibitMode = 'system-default' | 'prevent-display-sleep' | 'keep-system-awake'

export const GlobalConfigDialog: Component<Props> = (props) => {
  const [agentDefault, setAgentDefault] = createSignal<GlobalAgentKind>('claude')
  const [banner, setBanner] = createSignal(false)
  const [sound, setSound] = createSignal(false)
  const [powerMode, setPowerMode] = createSignal<PowerInhibitMode>('system-default')
  const [shortcuts, setShortcuts] = createSignal<ShortcutConfig>({})
  const [recording, setRecording] = createSignal<ShortcutActionId | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [saveStatus, setSaveStatus] = createSignal<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = createSignal<string | null>(null)
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
        applyConfig(await api.getGlobalConfig())
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
      await saveGlobalConfig({
        agent: {
          defaultKind: patch.agent?.defaultKind ?? agentDefault(),
        },
        notifications: {
          sessionEnd: {
            banner: patch.notifications?.sessionEnd.banner ?? banner(),
            sound: patch.notifications?.sessionEnd.sound ?? sound(),
          },
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

  function agentLabel(kind: GlobalAgentKind): string {
    if (kind === 'codex') return t('projectConfig.agentCodex')
    if (kind === 'opencode') return t('projectConfig.agentOpencode')
    return t('projectConfig.agentClaude')
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

  function updateAgentDefault(kind: GlobalAgentKind): void {
    setAgentDefault(kind)
    void persistPatch({ agent: { defaultKind: kind } })
  }

  function updateBanner(value: boolean): void {
    setBanner(value)
    void persistPatch({ notifications: { sessionEnd: { banner: value, sound: sound() } } })
  }

  function updateSound(value: boolean): void {
    setSound(value)
    void persistPatch({ notifications: { sessionEnd: { banner: banner(), sound: value } } })
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
            <RadioGroup
              class="m-0 flex flex-wrap gap-2 border-0 p-0"
              value={agentDefault()}
              onChange={(v) => updateAgentDefault(v as GlobalAgentKind)}
            >
              <RadioGroupLabel class="mb-1.5 w-full font-medium">
                {t('globalConfig.agentDefault')}
              </RadioGroupLabel>
              {(['claude', 'opencode', 'codex'] as const).map((kind) => (
                <RadioGroupItem value={kind} class="flex items-center gap-1.5">
                  <RadioGroupItemInput />
                  <RadioGroupItemControl />
                  <RadioGroupItemLabel class="cursor-pointer">
                    {agentLabel(kind)}
                  </RadioGroupItemLabel>
                </RadioGroupItem>
              ))}
            </RadioGroup>

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
