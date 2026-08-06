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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.jsx'
import { Button } from './ui/button.jsx'
import { Checkbox, CheckboxControl, CheckboxLabel } from './ui/checkbox.jsx'
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
  onSaved?: (message: string) => void
}

type GlobalAgentKind = 'claude' | 'opencode' | 'codex'
type PowerInhibitMode = 'system-default' | 'prevent-display-sleep' | 'keep-system-awake'

const DEFAULT_CONFIG: GlobalConfig = {
  agent: {
    defaultKind: 'claude',
  },
  notifications: {
    sessionEnd: {
      banner: false,
      sound: false,
    },
  },
  shortcuts: {},
  power: {
    inhibitWhenRunning: 'system-default',
  },
}

export const GlobalConfigDialog: Component<Props> = (props) => {
  const [agentDefault, setAgentDefault] = createSignal<GlobalAgentKind>('claude')
  const [banner, setBanner] = createSignal(false)
  const [sound, setSound] = createSignal(false)
  const [powerMode, setPowerMode] = createSignal<PowerInhibitMode>('system-default')
  const [shortcuts, setShortcuts] = createSignal<ShortcutConfig>({})
  const [recording, setRecording] = createSignal<ShortcutActionId | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const conflicts = createMemo(() => new Set(findShortcutConflicts(shortcuts())))

  createEffect(() => {
    if (!props.open) return
    setError(null)
    setLoading(true)
    void (async () => {
      try {
        applyConfig(await api.getGlobalConfig())
      } catch (err) {
        setError((err as Error).message)
        applyConfig(DEFAULT_CONFIG)
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
        setShortcuts((prev) => ({ ...prev, [action]: null }))
        setRecording(null)
        return
      }
      const binding = shortcutFromEvent(event)
      if (!binding) return
      setShortcuts((prev) => ({ ...prev, [action]: binding }))
      setRecording(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, true))
  })

  async function submit(e: Event): Promise<void> {
    e.preventDefault()
    setError(null)
    if (conflicts().size > 0) {
      setError(t('globalConfig.shortcutConflict'))
      return
    }
    setBusy(true)
    try {
      await api.updateGlobalConfig({
        agent: {
          defaultKind: agentDefault(),
        },
        notifications: {
          sessionEnd: {
            banner: banner(),
            sound: sound(),
          },
        },
        shortcuts: shortcuts(),
        power: {
          inhibitWhenRunning: powerMode(),
        },
      })
      props.onSaved?.(t('globalConfig.saved'))
      props.onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

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
    setShortcuts((prev) => ({ ...prev, [action]: null }))
  }

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent class="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('globalConfig.title')}</DialogTitle>
        </DialogHeader>

        <Show
          when={!loading()}
          fallback={<p class="text-muted-foreground">{t('common.loading')}</p>}
        >
          <form onSubmit={(e) => void submit(e)} class="flex flex-col gap-4">
            <fieldset class="m-0 flex flex-wrap gap-2 border-0 p-0">
              <legend class="mb-1.5 font-medium">{t('globalConfig.agentDefault')}</legend>
              {(['claude', 'opencode', 'codex'] as const).map((kind) => (
                <label class="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="global-config-agent-default"
                    value={kind}
                    checked={agentDefault() === kind}
                    onChange={() => setAgentDefault(kind)}
                    disabled={busy()}
                  />
                  <span>{agentLabel(kind)}</span>
                </label>
              ))}
            </fieldset>

            <fieldset class="m-0 flex flex-col gap-3 border-0 p-0">
              <legend class="font-medium">{t('globalConfig.sessionEnd')}</legend>
              <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Checkbox
                  checked={banner()}
                  onChange={(v) => setBanner(v)}
                  disabled={busy()}
                  class="flex items-center gap-2"
                >
                  <CheckboxControl />
                  <CheckboxLabel>{t('globalConfig.banner')}</CheckboxLabel>
                </Checkbox>
                <Checkbox
                  checked={sound()}
                  onChange={(v) => setSound(v)}
                  disabled={busy()}
                  class="flex items-center gap-2"
                >
                  <CheckboxControl />
                  <CheckboxLabel>{t('globalConfig.sound')}</CheckboxLabel>
                </Checkbox>
              </div>
            </fieldset>

            <fieldset class="m-0 flex flex-wrap gap-2 border-0 p-0">
              <legend class="mb-1.5 font-medium">{t('globalConfig.powerTitle')}</legend>
              {(['system-default', 'prevent-display-sleep', 'keep-system-awake'] as const).map(
                (mode) => (
                  <label class="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="radio"
                      name="global-config-power-inhibit"
                      value={mode}
                      checked={powerMode() === mode}
                      onChange={() => setPowerMode(mode)}
                      disabled={busy()}
                    />
                    <span>{powerModeLabel(mode)}</span>
                  </label>
                ),
              )}
            </fieldset>

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
                        disabled={busy()}
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
                        disabled={busy() || shortcutValue(action) === DEFAULT_SHORTCUTS[action]}
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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={props.onClose} disabled={busy()}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy() || conflicts().size > 0}>
                {busy() ? t('common.saving') : t('globalConfig.save')}
              </Button>
            </DialogFooter>
          </form>
        </Show>
      </DialogContent>
    </Dialog>
  )
}
