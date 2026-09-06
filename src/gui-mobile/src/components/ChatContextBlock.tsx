import { For, Show, type Component } from 'solid-js'
import { ChevronDown } from 'lucide-solid'
import type { AgentContextPart, ToolExpandState } from '@shared/lib/chat-blocks.js'
import { t } from '@/i18n/index.js'

/**
 * Agent 注入的上下文块（推荐插件 / AGENTS 指令 / 环境信息），默认折叠。
 *
 * 展开态走外部 `expand`，而不是像桌面端那样用组件内 `createSignal`——桌面端那份
 * 与同屏的 ChatToolBlock 口径不一致，流式重挂载时会被清零。这里顺手统一掉。
 */
export const ChatContextBlock: Component<{
  contexts: AgentContextPart[]
  expandKey: string
  expand: ToolExpandState
}> = (props) => {
  const open = (): boolean => props.expand.isExpanded(props.expandKey)

  return (
    <div class="mb-2">
      <button
        type="button"
        class="flex min-h-11 items-center gap-1.5 rounded border border-dashed px-2 text-left text-xs text-muted-foreground active:opacity-60"
        aria-expanded={open()}
        onClick={() => props.expand.set(props.expandKey, !open())}
      >
        <ChevronDown
          size={14}
          class={`shrink-0 transition-transform duration-150 ${open() ? '' : '-rotate-90'}`}
          aria-hidden="true"
        />
        <span class="font-mono">
          {t('chat.agentContextCollapsed', { count: props.contexts.length })}
        </span>
      </button>
      <Show when={open()}>
        <div class="scroll-y mt-1 max-h-72 space-y-2 rounded border border-dashed bg-muted/40 p-2">
          <For each={props.contexts}>
            {(ctx) => (
              <pre class="whitespace-pre-wrap rounded bg-background px-2 py-1 text-[11px] leading-snug text-muted-foreground">
                {ctx.text}
              </pre>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
