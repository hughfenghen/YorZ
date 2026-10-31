import { For, Index, Show, createSignal, type Component } from 'solid-js'
import { renderMarkdown } from '@shared/lib/markdown.js'
import {
  isRenderableImageSrc,
  type AgentContextBlock,
  type AssistantBlock,
  type ChatBlock,
  type DividerBlock,
  type ImagePart,
  type ImageSegment,
  type Segment,
  type ToolExpandState,
  type ToolsSegment,
  type UserBlock,
} from '@shared/lib/chat-blocks.js'
import { ChatToolBlock } from './ChatToolBlock.jsx'
import { ChatContextBlock } from './ChatContextBlock.jsx'
import { ImagePreview } from './ImagePreview.jsx'
import { t } from '@/i18n/index.js'

/**
 * 窄化辅助。`<Index>` 把元素交出来时是 accessor，TypeScript 无法跨两次
 * `block()` 调用收窄联合类型；把值过一层函数参数就能恢复收窄，且不破坏响应性
 * （调用仍发生在 `Show` 被追踪的 `when` 里）。与桌面端同一手法。
 */
const asDivider = (b: ChatBlock): DividerBlock | null => (b.kind === 'divider' ? b : null)
const asContext = (b: ChatBlock): AgentContextBlock | null => (b.kind === 'context' ? b : null)
const asAssistant = (b: ChatBlock): AssistantBlock | null => (b.kind === 'assistant' ? b : null)
const asUser = (b: ChatBlock): UserBlock | null => (b.kind === 'user' ? b : null)
const asTools = (s: Segment): ToolsSegment | null => (s.kind === 'tools' ? s : null)
const asImageSeg = (s: Segment): ImageSegment | null => (s.kind === 'image' ? s : null)
const segmentText = (s: Segment): string => (s.kind === 'text' ? s.text : '')

/**
 * 带 src 白名单的惰性图片行，用户气泡与 assistant 图片段共用。
 * 点击缩略图用 {@link ImagePreview} 全屏查看原图，避免 `max-h-64` 缩略把大图藏掉。
 */
const ChatImages: Component<{ images: ImagePart[] }> = (props) => {
  const [previewSrc, setPreviewSrc] = createSignal<string | undefined>()
  const [previewAlt, setPreviewAlt] = createSignal<string | undefined>()
  const [previewOpen, setPreviewOpen] = createSignal(false)
  const openPreview = (img: ImagePart) => {
    setPreviewSrc(img.src)
    setPreviewAlt(img.alt)
    setPreviewOpen(true)
  }
  return (
    <div class="mt-1 flex flex-wrap gap-1.5">
      <For each={props.images.filter((img) => isRenderableImageSrc(img.src))}>
        {(img) => (
          <img
            src={img.src}
            alt={img.alt ?? ''}
            loading="lazy"
            class="max-h-64 max-w-full cursor-zoom-in rounded border border-border object-contain"
            onClick={() => openPreview(img)}
          />
        )}
      </For>
      <ImagePreview
        src={previewSrc()}
        alt={previewAlt()}
        open={previewOpen()}
        onOpenChange={setPreviewOpen}
      />
    </div>
  )
}

/**
 * 历史消息与流式内容的渲染，四层 `Show` 分派：divider / context / assistant / user。
 *
 * 与桌面端 ChatPanel 的消息区同构（同一份 `ChatBlock` 模型、同一份
 * `renderMarkdown` 参数），差异只在尺度：气泡内边距与字号按拇指阅读放大，
 * 工具块不引 Kobalte。列表本身不共享成组件——参数化后只会退化成一堆 class 字符串。
 *
 * `Index` 而非 `For`：`groupParts` 每次重算都新建全部 block 与 segment 对象，
 * 引用键的 reconciliation 会在运行中每秒十余次拆掉整个消息区，连带工具块的
 * 滚动位置一起丢。位置键复用节点、只更新内容；part 流只在尾部增长，位置是稳定的。
 */
export const MessageList: Component<{
  blocks: ChatBlock[]
  expand: ToolExpandState
}> = (props) => (
  <Index each={props.blocks}>
    {(block, index) => (
      <Show
        when={asDivider(block())}
        fallback={
          <Show
            when={asContext(block())}
            fallback={
              <Show
                when={asAssistant(block())}
                fallback={
                  // 用户输入不过 markdown：里面常带 `@路径`、缩进和裸
                  // `*`/`_`，交给 md 会被改写成别的东西。
                  <div class="mb-2 whitespace-pre-wrap rounded-lg border border-primary/20 border-l-2 border-l-primary bg-primary/10 p-2 text-[0.95rem] font-medium [overflow-wrap:anywhere]">
                    <Show when={asUser(block())?.text}>{(text) => <span>{text()}</span>}</Show>
                    <Show when={asUser(block())?.images?.length}>
                      <ChatImages images={asUser(block())!.images!} />
                    </Show>
                  </div>
                }
              >
                {(assistant) => (
                  <div class="mb-2 min-w-0 rounded-lg border bg-card p-2 [overflow-wrap:anywhere]">
                    <Index each={assistant().segments}>
                      {(seg) => (
                        <Show
                          when={asImageSeg(seg())}
                          fallback={
                            <Show
                              when={asTools(seg())}
                              fallback={
                                <div
                                  class="markdown chat-md"
                                  // eslint-disable-next-line solid/no-innerhtml -- renderMarkdown 在 details/summary 白名单之外转义所有原始 HTML
                                  innerHTML={renderMarkdown(segmentText(seg()), {
                                    // 聊天里的 mermaid 走高亮代码块：一段还在流式输出的
                                    // 图源码是语法不完整的，渲染只会闪出一串报错。
                                    mermaid: 'code',
                                    fileLinks: 'copy',
                                    fileLinkTitle: t('chat.copyFilePath'),
                                  })}
                                />
                              }
                            >
                              {(tools) => <ChatToolBlock segment={tools()} expand={props.expand} />}
                            </Show>
                          }
                        >
                          {(imageSeg) => <ChatImages images={imageSeg().images} />}
                        </Show>
                      )}
                    </Index>
                  </div>
                )}
              </Show>
            }
          >
            {(context) => (
              <ChatContextBlock
                contexts={context().contexts}
                // 上下文块没有 segment id 可用，用位置做键：part 流只在尾部增长，
                // 已经画出来的块位置不会变。
                expandKey={`ctx${index}`}
                expand={props.expand}
              />
            )}
          </Show>
        }
      >
        {(divider) => (
          // 同一个 spec 的两轮 session 之间的边界。刻意是整条滚动里最轻的元素：
          // 它负责分隔，不该和两侧的气泡抢注意力。
          <div class="my-3 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span class="h-px flex-1 bg-border" />
            <span class="shrink-0">{divider().agentKind}</span>
            <span class="h-px flex-1 bg-border" />
          </div>
        )}
      </Show>
    )}
  </Index>
)
