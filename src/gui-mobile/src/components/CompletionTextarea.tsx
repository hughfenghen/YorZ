import { Show, createEffect, onCleanup, type Component } from 'solid-js'
import { createCompletion, type CompletionItem } from '@shared/lib/completion.js'
import { CompletionBar } from '@/components/CompletionBar.jsx'
import { BLUR_CLOSE_DELAY_MS, MOBILE_SEARCH_DEBOUNCE_MS } from '@/lib/completion-config.js'

/**
 * 带 `@` 文件路径补全的文本域，给表单类宿主用（新建 spec、追加任务）。
 *
 * **只接 `@`、不接 `/`**：不传 `slashCommands`，共享层的 `slashEnabled` 便为 false，
 * 开头打一个 `/` 不会弹出空指令面板。这与桌面端 `NewSpec` / `AppendTaskDialog`
 * 的口径一致——指令是会话语义，写需求描述时 `/` 只是路径分隔符。
 *
 * 候选条**内联排在文本域下方**，不用绝对定位：两个宿主都装在 `overflow-y: auto`
 * 的滚动容器里（页面正文 / `Sheet` 正文），浮层会被祖先裁掉；`Sheet` 卡片还有
 * `max-h-[85dvh]` 的上限。会话输入栏没这问题是因为它的候选条挂在 `.kb-inset`
 * 固定栏上、不在任何滚动容器内，所以那边不共用这个组件。
 *
 * 高度按 `rows` 固定、不自增高：表单里的文本域一开始就撑到 8 / 5 行，自增高只会
 * 让它在输入第一个字时先塌成一行。会话输入栏是反过来的（1 行起、随内容长），
 * 那套逻辑留在 `ChatComposer`。
 */
export const CompletionTextarea: Component<{
  /** 空串则关闭补全：没有项目就没有可搜的文件范围。 */
  projectId: string
  value: string
  onValueChange: (next: string) => void
  placeholder?: string
  rows?: number
  class?: string
}> = (props) => {
  let textareaEl: HTMLTextAreaElement | undefined
  let barEl: HTMLDivElement | undefined
  let blurTimer: ReturnType<typeof setTimeout> | null = null

  onCleanup(() => {
    if (blurTimer) clearTimeout(blurTimer)
  })

  const completion = createCompletion({
    projectId: () => props.projectId,
    value: () => props.value,
    onValueChange: (next) => props.onValueChange(next),
    searchDebounceMs: MOBILE_SEARCH_DEBOUNCE_MS,
  })

  const barOpen = () => completion.open() && completion.items().length > 0

  /**
   * 候选条一出现就把它滚进视口：软键盘弹起后可视区只剩三四百像素，内联在文本域
   * 下方的候选条很容易整条落在键盘后面。`block: 'nearest'` 只在确有必要时滚动，
   * 已经可见时不会把页面拽动。
   */
  createEffect(() => {
    if (!barOpen()) return
    requestAnimationFrame(() => barEl?.scrollIntoView({ block: 'nearest' }))
  })

  /**
   * 选中后自己收尾光标：共享层只负责算出替换后的文本与光标位置，聚焦与
   * setSelectionRange 属于宿主的 DOM。放到下一帧是因为此刻 `value` 刚下发、
   * textarea 还没重渲染，立即 setSelectionRange 会被覆盖。
   */
  function onSelectCompletion(item: CompletionItem): void {
    const outcome = completion.select(item)
    if (outcome.kind !== 'text') return
    requestAnimationFrame(() => {
      if (!textareaEl) return
      textareaEl.focus()
      textareaEl.setSelectionRange(outcome.cursorPos, outcome.cursorPos)
    })
  }

  return (
    <div>
      <textarea
        ref={textareaEl}
        rows={props.rows ?? 5}
        class={props.class}
        placeholder={props.placeholder}
        value={props.value}
        onInput={(e) => {
          props.onValueChange(e.currentTarget.value)
          completion.handleInput(e.currentTarget)
        }}
        // 候选项的手势会抑制合成事件，正常不会走到这里；
        // 真正点走（表单其它控件、遮罩）才收起候选条。
        onBlur={() => {
          if (blurTimer) clearTimeout(blurTimer)
          blurTimer = setTimeout(completion.close, BLUR_CLOSE_DELAY_MS)
        }}
      />
      <Show when={barOpen()}>
        <div ref={barEl}>
          <CompletionBar
            items={completion.items()}
            empty={false}
            inline
            onSelect={onSelectCompletion}
          />
        </div>
      </Show>
    </div>
  )
}
