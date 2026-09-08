import { Index, Show, type Component } from 'solid-js'
import { ChevronDown } from 'lucide-solid'
import { toolTextKey, type ToolExpandState, type ToolsSegment } from '@shared/lib/chat-blocks.js'
import { toolTextView } from '@shared/lib/chat-tool-text.js'
import { t } from '@/i18n/index.js'

/**
 * 一串连续工具调用，折叠成一行。
 *
 * 与桌面端同构，但不引 Kobalte Collapsible：那个组件的价值是展开高度动画，
 * 而移动端一次展开往往推动整屏重排，动画只会让人以为页面卡住。这里直接用
 * `<Show>`，触发条按 44px 触摸区做（桌面那条是 20px 高的脚注，手指点不中）。
 *
 * 展开态一律来自 `props.expand`（即共享 hook 持有的 `toolExpand`），组件自己
 * 不持状态：`groupParts` 每个流式 tick 都重建对象，组件内 signal 会被重挂载清零。
 */
export const ChatToolBlock: Component<{ segment: ToolsSegment; expand: ToolExpandState }> = (
  props,
) => {
  const open = (): boolean => props.expand.isExpanded(props.segment.id)

  return (
    <div class="my-1">
      <button
        type="button"
        class="flex w-full items-center gap-1.5 py-2 text-left text-xs text-muted-foreground active:opacity-60"
        aria-expanded={open()}
        onClick={() => props.expand.set(props.segment.id, !open())}
      >
        <ChevronDown
          size={14}
          class={`shrink-0 transition-transform duration-150 ${open() ? '' : '-rotate-90'}`}
          aria-hidden="true"
        />
        <span class="font-mono">
          {t('chat.toolCollapsed', { count: props.segment.tools.length })}
        </span>
      </button>
      <Show when={open()}>
        {/* 单条工具结果可能有几千行——限高，否则整段对话被顶出屏幕。
            上限比桌面小（24rem）：移动端可视高度本来就只有桌面的一半左右。 */}
        <div class="scroll-y mt-1 max-h-96 space-y-2 rounded border bg-background p-2">
          {/* Index 而非 For：每个 ToolPart 都是流式 tick 里新建的对象，
              引用键会整片替换行、把正在阅读的滚动位置重置掉。 */}
          <Index each={props.segment.tools}>
            {(tool, index) => (
              <div class="space-y-1">
                <Show when={tool().name}>
                  <div class="font-mono text-xs font-semibold">{tool().name}</div>
                </Show>
                <Show when={tool().input !== undefined}>
                  <ToolText
                    text={safeStringify(tool().input)}
                    expandKey={toolTextKey(props.segment.id, index, 'input')}
                    expand={props.expand}
                  />
                </Show>
                <Show when={tool().result !== undefined}>
                  <ToolText
                    text={tool().result ?? ''}
                    expandKey={toolTextKey(props.segment.id, index, 'result')}
                    expand={props.expand}
                    wrap
                  />
                </Show>
              </div>
            )}
          </Index>
        </div>
      </Show>
    </div>
  )
}

/**
 * 单条工具载荷的第二级折叠。
 *
 * 第一级藏的是「一整串调用」，这一级藏的是「一条载荷的正文」：少了它，
 * 展开一个含 Read 的调用串就会灌进几千行，同串里的其它工具全被挤出视野。
 * 载荷够短时不渲染任何折叠入口。
 */
const ToolText: Component<{
  text: string
  expandKey: string
  expand: ToolExpandState
  /** 结果按散文读，换行而不是横向滚动。 */
  wrap?: boolean
}> = (props) => {
  const view = () => toolTextView(props.text)
  const expanded = (): boolean => props.expand.isExpanded(props.expandKey)
  const collapsed = (): boolean => view().truncated && !expanded()

  return (
    <div class="space-y-1">
      <pre
        class={`overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] leading-snug ${props.wrap ? 'whitespace-pre-wrap' : ''}`}
      >
        {collapsed() ? `${view().preview}…` : props.text}
      </pre>
      <Show when={view().truncated}>
        <button
          type="button"
          class="flex min-h-11 items-center text-left text-xs text-muted-foreground active:opacity-60"
          onClick={() => props.expand.set(props.expandKey, !expanded())}
        >
          {expanded()
            ? t('chat.toolTextCollapse')
            : t('chat.toolTextExpand', { count: view().length })}
        </button>
      </Show>
    </div>
  )
}

/** 工具入参从网络上下来是 unknown；循环引用 / BigInt 不能把整页打崩。 */
function safeStringify(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2) ?? String(input)
  } catch {
    return String(input)
  }
}
