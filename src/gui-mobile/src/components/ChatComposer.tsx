import { For, Show, type Component } from 'solid-js'
import { Paperclip, Send, Square, X } from 'lucide-solid'
import type { AttachmentsController } from '@shared/lib/attachments.js'
import { ACCEPT_MIME, MAX_COUNT } from '@shared/lib/attachments.js'
import { t } from '@/i18n/index.js'

/**
 * 底部输入栏：自增高文本域 + 回形针 + 发送/中断互斥按钮。
 *
 * 不做桌面端的 `@` 文件补全与 `/` 命令弹层（见 spec 5.2）：两者都依赖 caret
 * 坐标定位浮层，而移动端的 caret 位置在软键盘、候选词条、放大镜之间不断变化，
 * 浮层要么盖住输入、要么飘到屏幕外。
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
}> = (props) => {
  let fileInput: HTMLInputElement | undefined
  const canSend = () =>
    props.value.trim().length > 0 && !props.starting && !props.attachments.hasPending()

  /**
   * 1 行起、最多 5 行。先清 height 再读 scrollHeight：不清的话上一次撑开的高度
   * 会成为 scrollHeight 的下界，文本删短后输入框再也收不回去。
   */
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 5 * 24 + 16)}px`
  }

  return (
    <div class="kb-inset shrink-0 border-t border-border bg-card px-safe pb-safe">
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

      <div class="flex items-end gap-2 px-4 py-2">
        <button
          type="button"
          class="tap-target flex shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-accent disabled:opacity-40"
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
          rows={1}
          class="min-h-11 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-base leading-6 outline-none focus:border-primary"
          placeholder={t('chat.placeholder')}
          value={props.value}
          onInput={(e) => {
            autoResize(e.currentTarget)
            props.onInput(e.currentTarget.value)
          }}
        />

        <Show
          when={props.running}
          fallback={
            <button
              type="button"
              class="tap-target flex shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground active:opacity-80 disabled:opacity-40"
              aria-label={t('chat.send')}
              disabled={!canSend()}
              onClick={() => props.onSend()}
            >
              <Send size={18} aria-hidden="true" />
            </button>
          }
        >
          <button
            type="button"
            class="tap-target flex shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground active:bg-accent"
            aria-label={t('chat.abort')}
            onClick={() => props.onAbort()}
          >
            <Square size={16} aria-hidden="true" />
          </button>
        </Show>
      </div>
    </div>
  )
}
