import { Show, createEffect, createSignal, type Component } from 'solid-js'
import type { SelectionSnapshot } from '@shared/lib/selection.js'
import { Sheet } from './Sheet.jsx'
import { t } from '@/i18n/index.js'

/** 回显选中原文的截断长度，与服务端落盘时的截断口径一致。 */
const QUOTE_PREVIEW = 200

/**
 * 选区批注弹窗。
 *
 * 与桌面 `AnnotatePopover` 一样**不发任何网络请求**：提交只是把一条草稿交回
 * 页面，真正的落盘发生在待确认项弹窗一次性提交答案 + 批注的时候。所以这里
 * 没有 busy 态，也没有失败分支。
 *
 * 桌面版内含 `MentionTextarea`（`@` 文件补全，478 行、靠 caret 定位浮层），
 * 移动端没有对应物也不做——上一个 spec 已就 chat 输入栏做过同样的裁剪。
 */
export const AnnotateSheet: Component<{
  open: boolean
  snap: SelectionSnapshot | null
  onClose: () => void
  onSubmit: (note: string) => void
}> = (props) => {
  const [note, setNote] = createSignal('')

  // 每次打开都从空白重来：上一条批注已经进了草稿列表，留在输入框里只会被重复提交。
  createEffect(() => {
    if (props.open) setNote('')
  })

  const canSubmit = () => note().trim().length > 0

  return (
    <Sheet
      open={props.open}
      title={t('specDetail.annotateTitle')}
      onClose={props.onClose}
      footer={
        <div class="flex items-center">
          <button
            type="button"
            class="ml-auto min-h-11 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground active:opacity-80 disabled:opacity-40"
            disabled={!canSubmit()}
            onClick={() => props.onSubmit(note().trim())}
          >
            {t('specDetail.annotateSubmit')}
          </button>
        </div>
      }
    >
      <Show when={props.snap}>
        {(snap) => (
          <div class="space-y-3">
            <p class="text-xs text-muted-foreground">
              {t('specDetail.annotateInSection', { section: snap().sectionPath })}
            </p>
            <blockquote class="m-0 break-words border-l-2 border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {snap().text.slice(0, QUOTE_PREVIEW)}
            </blockquote>
            <textarea
              rows={4}
              class="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
              placeholder={t('specDetail.annotatePlaceholder')}
              value={note()}
              onInput={(e) => setNote(e.currentTarget.value)}
            />
          </div>
        )}
      </Show>
    </Sheet>
  )
}
