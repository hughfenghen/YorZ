import { For, Show, onCleanup, type Component } from 'solid-js'
import { Pencil, Plus, Trash2 } from 'lucide-solid'
import { createCompletion, type CompletionItem, type SlashCommand } from '@shared/lib/completion.js'
import { cn } from '../lib/cn.js'
import { Button } from './ui/button.jsx'
import { AutoResizeTextarea } from './ui/textarea.jsx'

export type { SlashCommand }

/** Blur must outlive the候选项 mousedown, or the click never lands. */
const BLUR_CLOSE_DELAY_MS = 150

export interface MentionTextareaProps {
  /** Empty id disables completion (no project scope to search). */
  projectId: string
  value: string
  onValueChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  /**
   * Height floor in lines; also the initial row count. Defaults to 2.
   * Setting `minRows === maxRows` pins the box to a fixed row count.
   */
  minRows?: number
  /** Height cap in lines; past it the box scrolls. Defaults to 10. */
  maxRows?: number
  /** Static commands triggered by `/` at the beginning of the textarea. */
  slashCommands?: SlashCommand[]
  onSlashCommandAction?: (command: SlashCommand) => void
  onEditSlashCommand?: (command: SlashCommand) => void
  onDeleteSlashCommand?: (command: SlashCommand) => void
  /**
   * Shown instead of hiding the popup when a `/` query matches nothing. Without
   * it the popup vanishes, which reads as "commands are broken" rather than
   * "no such command". Host-supplied so this component stays i18n-free.
   */
  slashEmptyLabel?: string
  autofocus?: boolean
  required?: boolean
  class?: string
  /**
   * Runs *after* the mention state machine. When the popup consumed the key it
   * calls preventDefault(), so hosts must gate on `e.defaultPrevented` before
   * acting on Enter/Tab/Escape themselves.
   */
  onKeyDown?: (e: KeyboardEvent) => void
  onPaste?: (e: ClipboardEvent) => void
}

/**
 * Textarea with `@`-triggered file-path completion and content-driven height.
 *
 * Extracted from NewSpec so Chat can reuse it: keeping one copy is what keeps the
 * popup's active-item styling (and the IME/Enter precedence) consistent in both.
 *
 * The trigger/filter/splice logic lives in `@shared/lib/completion.js` so the
 * mobile composer can drive the same state machine behind its own UI; what stays
 * here is desktop-only — the anchored popup, keyboard navigation, and the row
 * edit/delete affordances.
 */
export const MentionTextarea: Component<MentionTextareaProps> = (props) => {
  let el: HTMLTextAreaElement | undefined
  let itemRefs: (HTMLLIElement | null)[] = []
  let blurTimer: ReturnType<typeof setTimeout> | null = null

  // The search timer is owned by createCompletion; this one is still ours.
  onCleanup(() => {
    if (blurTimer) clearTimeout(blurTimer)
  })

  const completion = createCompletion({
    projectId: () => props.projectId,
    value: () => props.value,
    onValueChange: (next) => props.onValueChange(next),
    slashCommands: () => props.slashCommands ?? [],
    slashEmptyEnabled: () => Boolean(props.slashEmptyLabel),
  })

  function selectItem(item: CompletionItem): void {
    itemRefs = []
    const outcome = completion.select(item)
    if (outcome.kind === 'noop') return
    if (outcome.kind === 'action') {
      props.onSlashCommandAction?.(outcome.command)
      requestAnimationFrame(() => el?.focus())
      return
    }
    // Height follows from the new `value` — AutoResizeTextarea's own effect owns it.
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(outcome.cursorPos, outcome.cursorPos)
    })
  }

  function deleteSlashItem(item: CompletionItem): void {
    if (item.kind !== 'slash') return
    props.onDeleteSlashCommand?.(item.command)
    if (item.customId) completion.removeSlashItem(item.customId)
  }

  function editSlashItem(item: CompletionItem): void {
    if (item.kind !== 'slash') return
    props.onEditSlashCommand?.(item.command)
    completion.close()
    requestAnimationFrame(() => el?.focus())
  }

  function scrollActiveIntoView(): void {
    itemRefs[completion.index()]?.scrollIntoView({ block: 'nearest' })
  }

  function onKeyDown(e: KeyboardEvent): void {
    const list = completion.items()
    if (completion.open() && list.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        completion.moveIndex(1)
        requestAnimationFrame(scrollActiveIntoView)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        completion.moveIndex(-1)
        requestAnimationFrame(scrollActiveIntoView)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        // An IME candidate-confirming Enter must not pick a mention (nor, for the
        // host, send the message) — let the composition swallow it.
        if (!e.isComposing) {
          e.preventDefault()
          selectItem(list[completion.index()]!)
          return
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        completion.close()
        return
      }
    }
    props.onKeyDown?.(e)
  }

  return (
    <div class="relative w-full">
      <AutoResizeTextarea
        ref={el}
        minRows={props.minRows}
        maxRows={props.maxRows}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        required={props.required}
        autofocus={props.autofocus}
        class={props.class}
        onInput={(e) => {
          props.onValueChange(e.currentTarget.value)
          itemRefs = []
          completion.handleInput(e.currentTarget)
        }}
        onKeyDown={onKeyDown}
        onPaste={(e) => props.onPaste?.(e)}
        onBlur={() => {
          if (blurTimer) clearTimeout(blurTimer)
          blurTimer = setTimeout(completion.close, BLUR_CLOSE_DELAY_MS)
        }}
      />
      <Show when={completion.open() && (completion.items().length > 0 || completion.slashEmpty())}>
        <ul class="absolute bottom-full left-0 right-0 z-[100] m-0 max-h-60 list-none overflow-y-auto rounded-lg border bg-card py-1 shadow-lg">
          <Show when={completion.slashEmpty()}>
            <li class="px-3 py-1.5 text-sm text-muted-foreground">{props.slashEmptyLabel}</li>
          </Show>
          <For each={completion.items()}>
            {(item, i) => (
              // The row highlight lives on the <li> so the delete control can be a
              // real sibling <button> — nesting one inside the select button was
              // invalid HTML, which is why it used to be a <span role="button">.
              <li
                ref={(node) => (itemRefs[i()] = node)}
                class={cn(
                  'flex items-center',
                  completion.index() === i()
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                )}
                onMouseEnter={() => completion.setIndex(i())}
              >
                <button
                  type="button"
                  title={item.kind === 'slash' && item.description ? item.description : item.value}
                  class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden border-0 bg-transparent px-3 py-1.5 text-left text-sm text-inherit"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectItem(item)
                  }}
                >
                  <Show when={item.kind === 'slash' && item.icon === 'plus'}>
                    <Plus class="h-3.5 w-3.5 shrink-0" />
                  </Show>
                  <span class="min-w-0 flex-1">
                    <span class="block overflow-hidden text-ellipsis whitespace-nowrap">
                      {item.kind === 'slash' ? item.label : item.value}
                    </span>
                    <Show when={item.kind === 'slash' && item.description}>
                      <span
                        class={cn(
                          'block overflow-hidden text-ellipsis whitespace-nowrap text-xs',
                          completion.index() === i()
                            ? 'text-primary-foreground/80'
                            : 'text-muted-foreground',
                        )}
                      >
                        {item.kind === 'slash' ? item.description : ''}
                      </span>
                    </Show>
                  </span>
                </button>
                <Show when={item.kind === 'slash' && (item.editable || item.deletable)}>
                  <div class="mr-1 flex shrink-0 items-center gap-0.5">
                    <Show when={item.kind === 'slash' && item.editable}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        tabIndex={-1}
                        title={item.kind === 'slash' ? item.editLabel : undefined}
                        class={cn(
                          'h-7 w-7 p-0',
                          completion.index() === i()
                            ? 'text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          editSlashItem(item)
                        }}
                      >
                        <Pencil class="h-3.5 w-3.5" />
                      </Button>
                    </Show>
                    <Show when={item.kind === 'slash' && item.deletable}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        tabIndex={-1}
                        title={item.kind === 'slash' ? item.deleteLabel : undefined}
                        class={cn(
                          'h-7 w-7 p-0',
                          completion.index() === i()
                            ? 'text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground'
                            : 'text-destructive hover:bg-destructive/10 hover:text-destructive',
                        )}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          deleteSlashItem(item)
                        }}
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
                    </Show>
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
