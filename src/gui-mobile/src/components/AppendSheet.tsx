import { For, createEffect, createSignal, type Component } from 'solid-js'
import { api, type AppendItemBody, type AppendItemKind } from '@shared/api/index.js'
import { Sheet } from './Sheet.jsx'
import { CompletionTextarea } from './CompletionTextarea.jsx'
import { showToast } from './Toast.jsx'
import { cn } from '@/lib/cn'
import { t } from '@/i18n/index.js'

const KINDS: { value: AppendItemKind; labelKey: string }[] = [
  { value: 'feat', labelKey: 'specDetail.appendKindFeat' },
  { value: 'refct', labelKey: 'specDetail.appendKindRefct' },
  { value: 'fix', labelKey: 'specDetail.appendKindFix' },
]

/**
 * 追加任务弹窗：类型三选一 + 描述。
 *
 * 默认 `fix`，与桌面端 `AppendTaskDialog` 一致——追加任务最常见的来源是
 * 「刚发现的问题」，默认值踩中它可以少点一次。
 *
 * 不传 `sectionPath` / `quote`：那两个字段来自桌面端的正文选区，移动端本次
 * 不做选区（见 spec 5.2），这里的追加是整篇级别的输入。
 */
export const AppendSheet: Component<{
  open: boolean
  projectId: string
  specId: string
  onClose: () => void
  /** 服务端已派发时带上会话 id；只存盘未派发（busy）时为空串。 */
  onSubmitted: (sessionId: string) => void
}> = (props) => {
  const [kind, setKind] = createSignal<AppendItemKind>('fix')
  const [description, setDescription] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  createEffect(() => {
    if (props.open) {
      setKind('fix')
      setDescription('')
    }
  })

  async function submit() {
    const text = description().trim()
    if (!text || busy()) return
    setBusy(true)
    try {
      const body: AppendItemBody = { kind: kind(), description: text }
      const res = await api.appendItem(props.projectId, props.specId, body)
      // busy：条目已写进 `## 追加任务`，但 spec 正忙、这一轮没有派发 agent。
      // 这不是失败——不能让用户以为要重提一次，那会写进两条重复条目。
      if (res.busy) {
        showToast(t('specDetail.appendSavedSpecBusy'), 'error')
        props.onSubmitted('')
        return
      }
      showToast(t('specDetail.appendSaved'))
      props.onSubmitted(res.sessionId ?? '')
    } catch (err) {
      showToast((err as Error).message || t('specDetail.appendFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={props.open}
      title={t('specDetail.appendTask')}
      onClose={props.onClose}
      footer={
        <button
          type="button"
          class="ml-auto flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground active:opacity-80 disabled:opacity-40"
          disabled={busy() || description().trim().length === 0}
          onClick={() => void submit()}
        >
          {busy() ? t('specDetail.submitting') : t('specDetail.submit')}
        </button>
      }
    >
      <div class="space-y-4">
        <div class="flex gap-2" role="radiogroup" aria-label={t('newSpec.type')}>
          <For each={KINDS}>
            {(item) => (
              <button
                type="button"
                role="radio"
                aria-checked={kind() === item.value}
                class={cn(
                  'min-h-11 flex-1 rounded-lg border text-sm active:opacity-80',
                  kind() === item.value
                    ? 'border-primary bg-primary/10 font-medium'
                    : 'border-border bg-background',
                )}
                onClick={() => setKind(item.value)}
              >
                {t(item.labelKey)}
              </button>
            )}
          </For>
        </div>

        <label class="block">
          <span class="mb-1 block text-xs text-muted-foreground">
            {t('specDetail.appendDescription')}
          </span>
          <CompletionTextarea
            projectId={props.projectId}
            rows={5}
            class="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
            placeholder={t('specDetail.appendDescriptionHint')}
            value={description()}
            onValueChange={setDescription}
          />
        </label>
      </div>
    </Sheet>
  )
}
