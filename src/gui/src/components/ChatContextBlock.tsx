import { For, createSignal, type Component } from 'solid-js'
import { ChevronDown } from 'lucide-solid'
import type { AgentContextPart } from '../lib/chat-blocks.js'
import { t } from '../i18n/index.js'
import { Collapsible, CollapsibleContent } from './ui/collapsible.jsx'

export const ChatContextBlock: Component<{ contexts: AgentContextPart[] }> = (props) => {
  const [open, setOpen] = createSignal(false)

  return (
    <Collapsible open={open()} onOpenChange={setOpen} class="mb-2">
      <button
        type="button"
        class="inline-flex w-fit cursor-pointer items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-left text-xs text-muted-foreground/80"
        onClick={() => setOpen(!open())}
        title={t('chat.agentContextCollapsed', { count: props.contexts.length })}
      >
        <ChevronDown
          class={`h-3 w-3 shrink-0 transition-transform duration-150 ${open() ? '' : '-rotate-90'}`}
        />
        <span class="font-mono">
          {t('chat.agentContextCollapsed', { count: props.contexts.length })}
        </span>
      </button>
      <CollapsibleContent>
        <div class="mt-1 max-h-72 space-y-2 overflow-auto rounded border border-dashed bg-muted/40 p-2">
          <For each={props.contexts}>
            {(ctx) => (
              <pre class="overflow-x-auto whitespace-pre-wrap rounded bg-background px-2 py-1 text-[11px] leading-snug text-muted-foreground">
                {ctx.text}
              </pre>
            )}
          </For>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
