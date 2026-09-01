import { createEffect, createSignal, onCleanup, Show, type Component } from 'solid-js'
import { Send, X } from 'lucide-solid'
import type { AppendItemBody, AppendItemKind } from '../lib/api.js'
import { Button } from './ui/button.jsx'
import { Checkbox, CheckboxControl, CheckboxLabel } from './ui/checkbox.jsx'
import { MentionTextarea } from './MentionTextarea.jsx'
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
  RadioGroupLabel,
} from './ui/radio-group.jsx'
import { t } from '../i18n/index.js'
import { createVisualViewport } from '../lib/visual-viewport.js'

interface Props {
  open: boolean
  projectId: string
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

  const vv = createVisualViewport()
  // 弹窗实测高度：钳制定位必须用真实高度，估算值偏小会让弹窗底部仍被键盘盖住。
  const [dialogHeight, setDialogHeight] = createSignal(0)

  createEffect(() => {
    if (!props.open) {
      setPos(null)
      return
    }
    const anchor = props.anchorEl
    if (!anchor) return
    // 依赖可视视口状态：移动端软键盘弹出/收起时重算，避免对话框被键盘遮挡。
    const vvState = vv()
    const height = dialogHeight() || 300
    const rect = anchor.getBoundingClientRect()
    // 与渲染层的 w-96 + max-w-[calc(100vw-2rem)] 保持一致：
    // 窄屏下实际宽度被 max-w 钳制，定位计算必须用钳制后的宽度。
    const width = Math.min(384, window.innerWidth - 32)
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))
    const vvTop = vvState.offsetTop
    const vvBottom = vvState.offsetTop + vvState.height
    const top = Math.max(vvTop + 8, Math.min(rect.bottom + 8, vvBottom - height - 8))
    setPos({ top, left })
  })

  createEffect(() => {
    if (!props.open) return
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
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
          class="append-dialog fixed z-50 flex max-h-[calc(100vh-16px)] w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4 shadow-lg"
          role="dialog"
          aria-label={t('appendTask.title')}
          ref={(el) => {
            queueMicrotask(() => {
              const h = el.offsetHeight
              if (h > 0 && h !== dialogHeight()) setDialogHeight(h)
            })
          }}
          style={
            pos()
              ? {
                  top: `${pos()!.top}px`,
                  left: `${pos()!.left}px`,
                  // 移动端键盘弹出时按可视视口高度收紧，配合内部滚动保证输入可达
                  ...(vv().keyboardOpen ? { maxHeight: `${vv().height - 16}px` } : {}),
                }
              : undefined
          }
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header class="flex flex-col gap-0.5">
            <strong class=" ">{t('appendTask.title')}</strong>
            <span class="text-sm text-muted-foreground">{t('appendTask.hint')}</span>
          </header>
          <form class="flex flex-col gap-3" onSubmit={submit}>
            <RadioGroup
              class="m-0 flex flex-col gap-1.5 border-0 p-0"
              value={kind()}
              onChange={(v) => setKind(v as AppendItemKind)}
              disabled={busy()}
            >
              <RadioGroupLabel class="mb-1 font-medium">{t('appendTask.type')}</RadioGroupLabel>
              {(['feat', 'refct', 'fix'] as const).map((k) => (
                <RadioGroupItem value={k} class="flex items-center gap-1.5">
                  <RadioGroupItemInput />
                  <RadioGroupItemControl />
                  <RadioGroupItemLabel class="cursor-pointer">{t(KIND_KEY[k])}</RadioGroupItemLabel>
                </RadioGroupItem>
              ))}
            </RadioGroup>

            <Show when={kind() === 'fix'}>
              <Checkbox
                class="ml-5 flex items-start gap-1.5"
                checked={debug()}
                onChange={setDebug}
                disabled={busy()}
              >
                <CheckboxControl class="mt-1" />
                <CheckboxLabel class="flex cursor-pointer flex-col">
                  <span class="font-medium">{t('appendTask.debugMode')}</span>
                  <span class="text-sm text-muted-foreground">{t('appendTask.debugModeHint')}</span>
                </CheckboxLabel>
              </Checkbox>
            </Show>

            <label class="flex flex-col gap-1 ">
              <span>{t('appendTask.description')}</span>
              <MentionTextarea
                projectId={props.projectId}
                rows={5}
                autosize={false}
                value={description()}
                onValueChange={setDescription}
                placeholder={t('appendTask.descPlaceholder')}
                autofocus
                disabled={busy()}
                class="resize-y"
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
