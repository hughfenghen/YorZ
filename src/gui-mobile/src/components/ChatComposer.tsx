import { For, Show, createEffect, onCleanup, type Component } from 'solid-js'
import { Paperclip, Send, Square, X } from 'lucide-solid'
import type { AttachmentsController } from '@shared/lib/attachments.js'
import { ACCEPT_MIME, MAX_COUNT } from '@shared/lib/attachments.js'
import { createCompletion, type CompletionItem, type SlashCommand } from '@shared/lib/completion.js'
import { autoSizeTextarea } from '@/lib/autosize.js'
import { BLUR_CLOSE_DELAY_MS, MOBILE_SEARCH_DEBOUNCE_MS } from '@/lib/completion-config.js'
import { CompletionBar } from '@/components/CompletionBar.jsx'
import { t } from '@/i18n/index.js'

/** 输入框最多长到 5 行，再多就内部滚动。 */
const MAX_ROWS = 5

/**
 * 底部输入栏：自增高文本域 + 回形针 + 发送/中断互斥按钮，
 * 以及 `/` 指令与 `@` 文件路径补全（候选条见 `CompletionBar`）。
 *
 * 补全的触发判定、模糊排序与文本替换全部来自 `@shared/lib/completion.js`，
 * 与桌面 `MentionTextarea` 是同一份状态机；这里只接了触屏那套交互。
 * 尤其 `/` 指令选中后插入的文本必须由共享层的 `buildSlashReplacement` 生成：
 * 服务端靠前导 `/name` 反查指令并注入 hiddenPrompt，前缀丢了会静默失效。
 *
 * `.kb-inset` 是 iOS 软键盘的占位（见 lib/keyboard.ts），`.pb-safe` 是 home
 * indicator 的占位——两者叠加而不是二选一：键盘收起时只需要后者，弹出时前者
 * 已经把可视区压上去了，后者归零由浏览器负责。
 */
export const ChatComposer: Component<{
  value: string
  onInput: (v: string) => void
  onSend: () => void
  onAbort: () => void
  running: boolean
  /** 建号 → 订阅 → 首发的握手进行中，禁止二次触发。 */
  starting: boolean
  attachments: AttachmentsController
  /** 空串则关闭补全：没有项目就没有可搜的文件范围。 */
  projectId: string
  /** 空数组则只留 `@`，不触发 `/`。 */
  slashCommands: SlashCommand[]
}> = (props) => {
  let fileInput: HTMLInputElement | undefined
  let textareaEl: HTMLTextAreaElement | undefined
  let blurTimer: ReturnType<typeof setTimeout> | null = null
  onCleanup(() => {
    if (blurTimer) clearTimeout(blurTimer)
  })
  const canSend = () =>
    props.value.trim().length > 0 && !props.starting && !props.attachments.hasPending()

  const completion = createCompletion({
    projectId: () => props.projectId,
    value: () => props.value,
    onValueChange: (next) => props.onInput(next),
    slashCommands: () => props.slashCommands,
    slashEmptyEnabled: () => true,
    searchDebounceMs: MOBILE_SEARCH_DEBOUNCE_MS,
  })

  /**
   * 高度跟着 `value` 走，而不是只跟着 `onInput` 走：发送成功后文本由父组件清空，
   * 没有 input 事件，只挂 onInput 的话输入框会保持发送前撑开的高度。
   * 首次挂载也走这条路径，给出确定的 1 行初始高度。
   */
  createEffect(() => {
    props.value
    if (textareaEl) autoSizeTextarea(textareaEl, MAX_ROWS)
  })

  /**
   * 选中候选项后自己收尾光标：共享层只负责算出替换后的文本与光标位置，
   * 聚焦与 setSelectionRange 属于宿主的 DOM。放到下一帧是因为此刻 `value`
   * 刚下发、textarea 还没重渲染，立即 setSelectionRange 会被覆盖。
   */
  function onSelectCompletion(item: CompletionItem): void {
    const outcome = completion.select(item)
    if (outcome.kind !== 'text') return
    requestAnimationFrame(() => {
      if (!textareaEl) return
      textareaEl.focus()
      textareaEl.setSelectionRange(outcome.cursorPos, outcome.cursorPos)
      autoSizeTextarea(textareaEl, MAX_ROWS)
    })
  }

  return (
    <div class="kb-inset shrink-0 border-t border-border bg-card px-safe pb-safe">
      <Show when={completion.open() && (completion.items().length > 0 || completion.slashEmpty())}>
        <CompletionBar
          items={completion.items()}
          empty={completion.slashEmpty()}
          onSelect={onSelectCompletion}
        />
      </Show>

      <Show when={props.attachments.attachments().length > 0}>
        {/* 横向滚动的缩略图条：竖排会在小屏上把输入框挤出视口 */}
        <div class="flex gap-2 overflow-x-auto px-4 pt-2">
          <For each={props.attachments.attachments()}>
            {(att) => (
              <div class="relative shrink-0">
                <Show
                  when={att.previewUrl}
                  fallback={
                    <div class="flex h-14 w-20 items-center justify-center rounded border bg-muted px-1 text-[10px] text-muted-foreground">
                      <span class="truncate-start block w-full">{att.name}</span>
                    </div>
                  }
                >
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    class="h-14 w-20 rounded border object-cover"
                  />
                </Show>
                {/* 上传中/失败的状态直接压在缩略图上，不另开一行文案 */}
                <Show when={att.status !== 'uploaded'}>
                  <span
                    class={`absolute inset-0 flex items-center justify-center rounded text-[10px] ${
                      att.status === 'failed'
                        ? 'bg-destructive/70 text-destructive-foreground'
                        : 'bg-background/60 text-muted-foreground'
                    }`}
                  >
                    {att.status === 'failed' ? '!' : '…'}
                  </span>
                </Show>
                <button
                  type="button"
                  class="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground"
                  aria-label={t('common.close')}
                  onClick={() => void props.attachments.removeAttachment(att.id)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.attachments.error()}>
        <p class="px-4 pt-2 text-xs text-destructive">{props.attachments.error()}</p>
      </Show>

      {/*
        gap-3 与 mb-3：图标按钮的视觉盒就是 20×20 的图标本身（见 app.css），
        命中区靠伪元素各向外扩 12px——间距取 12px 时相邻命中区正好相接不重叠，
        底部再抬 12px，图标才落在输入框最后一行文字的高度上而不是贴着下边框。
      */}
      <div class="flex items-end gap-3 px-4 py-2">
        <button
          type="button"
          class="tap-target mb-3 flex shrink-0 items-center justify-center text-muted-foreground active:opacity-60 disabled:opacity-40"
          aria-label={t('chat.attach')}
          disabled={props.attachments.count() >= MAX_COUNT}
          onClick={() => fileInput?.click()}
        >
          <Paperclip size={20} aria-hidden="true" />
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept={ACCEPT_MIME}
          onChange={(e) => void props.attachments.onFileInputChange(e)}
        />

        <textarea
          ref={textareaEl}
          rows={1}
          class="flex-1 resize-none overflow-y-hidden rounded-lg border border-border bg-background px-3 py-2.5 text-base leading-6 outline-none focus:border-primary"
          placeholder={t('chat.placeholder')}
          value={props.value}
          onInput={(e) => {
            autoSizeTextarea(e.currentTarget, MAX_ROWS)
            props.onInput(e.currentTarget.value)
            completion.handleInput(e.currentTarget)
          }}
          // 候选项的手势会抑制合成事件，正常不会走到这里；
          // 真正点走（消息区、附件按钮）才收起候选条。
          onBlur={() => {
            if (blurTimer) clearTimeout(blurTimer)
            blurTimer = setTimeout(completion.close, BLUR_CLOSE_DELAY_MS)
          }}
        />

        <Show
          when={props.running}
          fallback={
            <button
              type="button"
              // 20×20 的盒子被图标本身填满，填色底与描边框都只会被盖住，
              // 于是改用色彩区分语义：发送用主色，中断用危险色。
              class="tap-target mb-3 flex shrink-0 items-center justify-center text-primary active:opacity-60 disabled:opacity-40"
              aria-label={t('chat.send')}
              disabled={!canSend()}
              onClick={() => props.onSend()}
            >
              <Send size={20} aria-hidden="true" />
            </button>
          }
        >
          <button
            type="button"
            class="tap-target mb-3 flex shrink-0 items-center justify-center text-destructive active:opacity-60"
            aria-label={t('chat.abort')}
            onClick={() => props.onAbort()}
          >
            <Square size={20} aria-hidden="true" />
          </button>
        </Show>
      </div>
    </div>
  )
}
