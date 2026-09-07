import { For, Show, type Component } from 'solid-js'
import { FileCode2 } from 'lucide-solid'
import type { CompletionItem } from '@shared/lib/completion.js'
import { createTapSelect } from '@/lib/tap-select.js'
import { cn } from '@/lib/cn'
import { t } from '@/i18n/index.js'

/**
 * `/` 指令与 `@` 文件路径的候选条。会话输入栏把它贴在输入框正上方，表单类宿主
 * （`CompletionTextarea`）把它内联排在文本域下方——两种摆法由 `inline` 区分。
 *
 * 与桌面端弹层的三点差异，都是触屏与软键盘逼出来的：
 *
 * 1. **不做键盘导航**。桌面靠 ↑↓ + Enter 选中，移动端没有这些键，只保留点选；
 *    连带 IME 的 `isComposing` 分支也不需要——那条分支存在的意义是「别让中文候选
 *    词的 Enter 被当成选中」，而这里 Enter 根本不参与选中。
 * 2. **限高用 `dvh` 而不是固定像素**。桌面 `max-h-60`(240px) 在手机上会顶穿：
 *    软键盘弹出后可视区常只剩 300-400px，候选条再占 240px 就把消息区挤没了。
 * 3. **选中发生在 pointerup，而不是 pointerdown 或 click**。候选项按钮铺满整行，
 *    在 pointerdown 里 preventDefault 会连带取消 touchstart 的默认行为，列表就
 *    滚不动了；退到 click 又太晚——焦点迁移收起键盘、布局回落，点击会落到错位的
 *    那一项。pointerup 卡在中间：滚动手势已能被位移判据排除，合成事件还没发生。
 *    判据本身在 `lib/tap-select.ts`，那里有完整说明。
 *
 * 定位上不需要 caret 坐标：候选条是输入框的兄弟节点、整宽排布，跟着宿主一起被
 * 键盘顶上去。桌面端同理（`absolute bottom-full`），两端都不测量光标。
 */
export const CompletionBar: Component<{
  items: CompletionItem[]
  /** `/` 查询无匹配：显示一行「没有匹配的指令」而不是整条消失。 */
  empty: boolean
  /**
   * 内联在表单流里（而不是贴在输入栏顶边）。贴边时上边框由宿主容器负责，
   * 内联时得自己长出四边边框与圆角，否则在表单里看起来像断开的一块。
   */
  inline?: boolean
  onSelect: (item: CompletionItem) => void
}> = (props) => {
  return (
    <div
      class={cn(
        'bg-card',
        props.inline
          ? 'mt-1 overflow-hidden rounded-lg border border-border'
          : 'border-b border-border',
      )}
      data-testid="completion-bar"
    >
      <ul class="scroll-y m-0 max-h-[38dvh] list-none p-0">
        <Show when={props.empty}>
          <li class="px-4 py-3 text-sm text-muted-foreground">{t('chat.slashCommandNoMatch')}</li>
        </Show>
        <For each={props.items}>
          {(item) => {
            const tap = createTapSelect({ onTap: () => props.onSelect(item) })
            return (
              <li class="border-b border-border/50 last:border-b-0">
                <button
                  type="button"
                  data-testid="completion-item"
                  // min-h 44px 是触摸命中区下限；文本再短也不能压缩这一行。
                  class="flex min-h-[44px] w-full items-center gap-3 border-0 bg-transparent px-4 py-2 text-left active:bg-accent"
                  {...tap}
                >
                  {/*
                    指令项不给图标槽：`/` 与 `@` 的候选列表互斥出现，同一屏里不会
                    混排，省掉那个图标能让指令名直接从内边距起排、少一层视觉噪音。
                  */}
                  <Show when={item.kind === 'mention'}>
                    <span class="shrink-0 text-muted-foreground">
                      <FileCode2 size={16} aria-hidden="true" />
                    </span>
                  </Show>
                  <span class="min-w-0 flex-1">
                    {/* 路径截首不截尾：`…/components/ChatComposer.tsx` 比
                        `src/gui-mobile/src/com…` 有用得多，文件名在尾部。 */}
                    <span
                      class={
                        item.kind === 'slash'
                          ? 'block truncate text-sm'
                          : 'truncate-start block text-sm'
                      }
                    >
                      {item.kind === 'slash' ? item.label : item.value}
                    </span>
                    <Show when={item.kind === 'slash' && item.description}>
                      <span class="block truncate text-xs text-muted-foreground">
                        {item.kind === 'slash' ? item.description : ''}
                      </span>
                    </Show>
                  </span>
                </button>
              </li>
            )
          }}
        </For>
      </ul>
    </div>
  )
}
