import { Index, Show, type Component } from 'solid-js'
import { ChevronDown } from 'lucide-solid'
import { toolTextKey, type ToolsSegment } from '../lib/chat-blocks.js'
import { toolTextView } from '../lib/chat-tool-text.js'
import { t } from '../i18n/index.js'
import { Collapsible, CollapsibleContent } from './ui/collapsible.jsx'

/**
 * Expand state for every collapsible in the tool tree, owned by `ChatPanel`.
 *
 * It cannot live inside this component. `groupParts` allocates new objects on
 * every stream tick, so the panel's list reconciliation tears these instances
 * down and rebuilds them several times a second while a session runs — an
 * instance-local signal was reset to `false` under the reader's cursor. Keyed
 * by the segment's stable id (see `ToolsSegment.id`), the state now outlives
 * both the re-render and a mid-run transcript re-read.
 */
export interface ToolExpandState {
  isExpanded: (key: string) => boolean
  /** Idempotent by design: the same value may be written twice per click. */
  set: (key: string, value: boolean) => void
}

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
export const ChatToolBlock: Component<{ segment: ToolsSegment; expand: ToolExpandState }> = (
  props,
) => {
  const open = (): boolean => props.expand.isExpanded(props.segment.id)
  const setOpen = (value: boolean): void => props.expand.set(props.segment.id, value)

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
        <span class="font-mono">
          {t('chat.toolCollapsed', { count: props.segment.tools.length })}
        </span>
      </button>
      <CollapsibleContent>
        {/* A single tool result can be thousands of lines — cap the viewport,
            don't let it push the conversation off-screen. The cap is generous
            (512px) because each payload inside is itself capped at a preview:
            what fills this box is now a summary of the run, not one payload's
            first screenful. */}
        <div class="mt-1 max-h-[32rem] space-y-2 overflow-auto rounded border bg-background p-2">
          {/* `Index`, not `For`: every ToolPart here is a fresh object on each
              stream tick, so reference-keyed reconciliation would replace all
              the rows — and replacing the rows resets this box's scrollTop out
              from under whoever is reading it. Positional keying updates the
              text in place instead. */}
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
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * One tool payload, with a second level of collapse.
 *
 * The `[Tool] ×N` row hides a whole run; this hides the bulk of a single
 * payload. Without it, opening a run with one `Read` in it dumps thousands of
 * lines into the box above and every other tool in the run scrolls out of
 * reach — the first level stops being useful precisely when the run is
 * interesting. Short payloads render whole and show no affordance at all.
 */
const ToolText: Component<{
  text: string
  expandKey: string
  expand: ToolExpandState
  /** Wrap long lines instead of scrolling horizontally (results read as prose). */
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
          class="inline-flex w-fit cursor-pointer items-center text-left text-[11px] text-muted-foreground/70"
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

/** Tool inputs come off the wire as `unknown`; cycles/BigInt must not crash the panel. */
function safeStringify(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2) ?? String(input)
  } catch {
    return String(input)
  }
}
