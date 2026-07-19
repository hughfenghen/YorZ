import { createEffect, createSignal, onCleanup, Show, type Component } from 'solid-js'
import { Send, X } from 'lucide-solid'
import type { AppendItemBody, AppendItemKind } from '../lib/api.js'
import { Button } from './ui/button.jsx'
import { Textarea } from './ui/textarea.jsx'
import { t } from '../i18n/index.js'

interface Props {
  open: boolean
  sectionPath?: string
  quote?: string
  anchorEl?: HTMLElement
  onCancel: () => void
  onSubmit: (body: AppendItemBody) => Promise<void>
}

const KIND_KEY: Record<AppendItemKind, string> = {
  feat: 'appendTask.kindFeat',
  refct: 'appendTask.kindRefct',
  fix: 'appendTask.kindFix',
}

export const AppendTaskDialog: Component<Props> = (props) => {
  const [kind, setKind] = createSignal<AppendItemKind>('fix')
  const [debug, setDebug] = createSignal(false)
  const [description, setDescription] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [pos, setPos] = createSignal<{ top: number; left: number } | null>(null)

  createEffect(() => {
    if (!props.open) {
      setPos(null)
      return
    }
    const anchor = props.anchorEl
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = 384
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))
    setPos({ top: rect.bottom + 8, left })
  })

  createEffect(() => {
    if (!props.open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', handler)
    onCleanup(() => window.removeEventListener('keydown', handler))
  })

  function reset() {
    setKind('fix')
    setDebug(false)
    setDescription('')
    setError(null)
  }

  async function submit(e: Event) {
    e.preventDefault()
    const desc = description().trim()
    if (!desc) {
      setError(t('appendTask.descRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit({
        kind: kind(),
        description: desc,
        sectionPath: props.sectionPath,
        quote: props.quote,
        debug: kind() === 'fix' ? debug() : undefined,
      })
      reset()
      props.onCancel()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    props.onCancel()
  }

  return (
    <Show when={props.open}>
      <div class="append-dialog-backdrop fixed inset-0 z-50" onMouseDown={cancel}>
        <div
          class="append-dialog fixed z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border bg-card p-4 shadow-lg"
          role="dialog"
          aria-label={t('appendTask.title')}
          style={pos() ? { top: `${pos()!.top}px`, left: `${pos()!.left}px` } : undefined}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header class="flex flex-col gap-0.5">
            <strong class=" ">{t('appendTask.title')}</strong>
            <span class="text-sm text-muted-foreground">{t('appendTask.hint')}</span>
          </header>
          <form class="flex flex-col gap-3" onSubmit={submit}>
            <fieldset class="m-0 flex flex-col gap-1.5 border-0 p-0" disabled={busy()}>
              <legend class="mb-1 font-medium">{t('appendTask.type')}</legend>
              {(['feat', 'refct', 'fix'] as const).map((k) => (
                <label class="flex cursor-pointer items-center gap-1.5 ">
                  <input
                    type="radio"
                    name="append-kind"
                    value={k}
                    checked={kind() === k}
                    onChange={() => setKind(k)}
                    disabled={busy()}
                  />
                  <span>{t(KIND_KEY[k])}</span>
                </label>
              ))}
            </fieldset>

            <Show when={kind() === 'fix'}>
              <label class="flex cursor-pointer items-start gap-1.5 ml-5">
                <input
                  type="checkbox"
                  class="mt-1"
                  checked={debug()}
                  onChange={(e) => setDebug(e.currentTarget.checked)}
                  disabled={busy()}
                />
                <span class="flex flex-col">
                  <span class="font-medium">{t('appendTask.debugMode')}</span>
                  <span class="text-sm text-muted-foreground">{t('appendTask.debugModeHint')}</span>
                </span>
              </label>
            </Show>

            <label class="flex flex-col gap-1 ">
              <span>{t('appendTask.description')}</span>
              <Textarea
                rows={5}
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                placeholder={t('appendTask.descPlaceholder')}
                autofocus
                disabled={busy()}
              />
            </label>

            <Show when={props.sectionPath || props.quote}>
              <div class="flex flex-col gap-1 text-sm">
                <Show when={props.sectionPath}>
                  <div>
                    <span class="text-muted-foreground">{t('appendTask.refSection')}</span>
                    <code class="font-mono">{props.sectionPath}</code>
                  </div>
                </Show>
                <Show when={props.quote}>
                  <blockquote class="m-0 border-l-2 border-border pl-2 text-muted-foreground">
                    {props.quote?.slice(0, 200)}
                  </blockquote>
                </Show>
              </div>
            </Show>

            <Show when={error()}>
              <p class="text-destructive ">{error()}</p>
            </Show>

            <div class="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={busy()}>
                {t('common.cancel')}
              </Button>
              {/* Mirrors the Chat composer's Send button — agent-triggering
                  buttons share one visual language. */}
              <Button type="submit" variant="default" size="sm" disabled={busy()}>
                <Send class="mr-1 h-3.5 w-3.5" />
                {busy() ? t('common.submitting') : t('appendTask.submit')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  )
}
