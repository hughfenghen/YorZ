import { createEffect, createSignal, Show, type Component } from 'solid-js'
import { api, type GlobalConfig } from '../lib/api.js'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.jsx'
import { Button } from './ui/button.jsx'
import { Checkbox, CheckboxControl, CheckboxLabel } from './ui/checkbox.jsx'
import { t } from '../i18n/index.js'

interface Props {
  open: boolean
  onClose: () => void
  onSaved?: (message: string) => void
}

type GlobalAgentKind = 'claude' | 'opencode' | 'codex'

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
}

export const GlobalConfigDialog: Component<Props> = (props) => {
  const [agentDefault, setAgentDefault] = createSignal<GlobalAgentKind>('claude')
  const [banner, setBanner] = createSignal(false)
  const [sound, setSound] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

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
  }

  async function submit(e: Event): Promise<void> {
    e.preventDefault()
    setError(null)
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

  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent class="max-w-[440px]">
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

            {error() && <p class="text-destructive">{error()}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={props.onClose} disabled={busy()}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy()}>
                {busy() ? t('common.saving') : t('globalConfig.save')}
              </Button>
            </DialogFooter>
          </form>
        </Show>
      </DialogContent>
    </Dialog>
  )
}
