import { For, Show, createSignal, type Component } from 'solid-js'
import { ChevronDown } from 'lucide-solid'
import type { ToolPart } from '../lib/chat-blocks.js'
import { t } from '../i18n/index.js'
import { Collapsible, CollapsibleContent } from './ui/collapsible.jsx'

/**
 * A run of consecutive tool calls, collapsed to a single line.
 *
 * The collapsed row shows only `[Tool] ×N` — no tool names, no chrome. Chat is a
 * narrow column and a name list ("Read, Bash, Edit, Read, …") wraps to several
 * lines, which is exactly the noise this block exists to hide. Names, inputs and
 * results are all one click away.
 *
 * The trigger is deliberately styled *down* to near-invisibility: no border, no
 * background, no hover, no indent — it is a footnote inside the agent's message,
 * not a control competing with the prose around it. Only the expanded panel gets
 * chrome, because that is when its content actually matters.
 */
export const ChatToolBlock: Component<{ tools: ToolPart[] }> = (props) => {
  const [open, setOpen] = createSignal(false)

  return (
    <Collapsible open={open()} onOpenChange={setOpen} class="my-1">
      <button
        type="button"
        class="inline-flex w-fit cursor-pointer items-center gap-1 py-0.5 text-left text-xs text-muted-foreground/70"
        onClick={() => setOpen(!open())}
      >
        <ChevronDown
          class={`h-3 w-3 shrink-0 transition-transform duration-150 ${open() ? '' : '-rotate-90'}`}
        />
        <span class="font-mono">{t('chat.toolCollapsed', { count: props.tools.length })}</span>
      </button>
      <CollapsibleContent>
        {/* A single tool result can be thousands of lines — cap it, don't let it
            push the conversation off-screen. */}
        <div class="mt-1 max-h-64 space-y-2 overflow-auto rounded border bg-background p-2">
          <For each={props.tools}>
            {(tool) => (
              <div class="space-y-1">
                <Show when={tool.name}>
                  <div class="font-mono text-xs font-semibold">{tool.name}</div>
                </Show>
                <Show when={tool.input !== undefined}>
                  <pre class="overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] leading-snug">
                    {safeStringify(tool.input)}
                  </pre>
                </Show>
                <Show when={tool.result !== undefined}>
                  <pre class="overflow-x-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-[11px] leading-snug">
                    {tool.result}
                  </pre>
                </Show>
              </div>
            )}
          </For>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Tool inputs come off the wire as `unknown`; cycles/BigInt must not crash the panel. */
function safeStringify(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2) ?? String(input)
  } catch {
    return String(input)
  }
}
