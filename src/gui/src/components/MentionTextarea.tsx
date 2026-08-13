import {
  For,
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js'
import { Plus, Trash2 } from 'lucide-solid'
import { cn } from '../lib/cn.js'
import { api } from '../lib/api.js'
import { Button } from './ui/button.jsx'
import { Textarea } from './ui/textarea.jsx'

const SEARCH_DEBOUNCE_MS = 150
/** Blur must outlive the候选项 mousedown, or the click never lands. */
const BLUR_CLOSE_DELAY_MS = 150
const DEFAULT_MIN_ROWS = 2
const DEFAULT_MAX_ROWS = 10
/** getComputedStyle returns `normal` for an unset line-height. */
const NORMAL_LINE_HEIGHT_RATIO = 1.5
const FUZZY_SCORE_MATCH = 16
const FUZZY_SCORE_PREFIX = 48
const FUZZY_SCORE_CONSECUTIVE = 24
const FUZZY_SCORE_BOUNDARY = 8

export interface SlashCommand {
  value: string
  label?: string
  description?: string
  replacement?: string
  action?: 'add'
  customId?: string
  deletable?: boolean
  deleteLabel?: string
  icon?: 'plus'
}

type CompletionItem =
  | { kind: 'mention'; value: string }
  | {
      kind: 'slash'
      value: string
      label: string
      description?: string
      replacement?: string
      action?: 'add'
      customId?: string
      deletable?: boolean
      deleteLabel?: string
      icon?: 'plus'
      command: SlashCommand
    }

interface ScoredSlashCommand {
  cmd: SlashCommand
  score: number
  index: number
}

export interface MentionTextareaProps {
  /** Empty id disables completion (no project scope to search). */
  projectId: string
  value: string
  onValueChange: (next: string) => void
  placeholder?: string
  disabled?: boolean
  /** Grow the box with its content between these bounds. Default on. */
  autosize?: boolean
  minRows?: number
  maxRows?: number
  /** Fixed row count; only meaningful with `autosize={false}`. */
  rows?: number
  /** Static commands triggered by `/` at the beginning of the textarea. */
  slashCommands?: SlashCommand[]
  onSlashCommandAction?: (command: SlashCommand) => void
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

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '')
}

function isFuzzyBoundary(target: string, index: number): boolean {
  if (index === 0) return true
  return /[\s/_.-]/.test(target[index - 1] ?? '')
}

function scoreFuzzyText(query: string, target: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let score = 0
  let lastIndex = -1

  for (let qi = 0; qi < q.length; qi++) {
    const nextIndex = t.indexOf(q[qi]!, lastIndex + 1)
    if (nextIndex === -1) return null

    score += FUZZY_SCORE_MATCH
    if (nextIndex === qi) score += FUZZY_SCORE_PREFIX
    if (nextIndex === lastIndex + 1) score += FUZZY_SCORE_CONSECUTIVE
    if (isFuzzyBoundary(target, nextIndex)) score += FUZZY_SCORE_BOUNDARY
    score -= Math.max(0, nextIndex - lastIndex - 1)
    lastIndex = nextIndex
  }

  return score - target.length * 0.01
}

function scoreFuzzySlashCommand(query: string, cmd: SlashCommand): number | null {
  const q = stripLeadingSlash(query.trim())
  if (!q) return 0
  const valueScore = scoreFuzzyText(q, stripLeadingSlash(cmd.value))
  const labelScore = cmd.label ? scoreFuzzyText(q, stripLeadingSlash(cmd.label)) : null
  if (valueScore == null) return labelScore
  if (labelScore == null) return valueScore
  return Math.max(valueScore, labelScore)
}

function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands
  return commands
    .map<ScoredSlashCommand | null>((cmd, index) => {
      const score = scoreFuzzySlashCommand(query, cmd)
      return score == null ? null : { cmd, score, index }
    })
    .filter((entry): entry is ScoredSlashCommand => entry != null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.cmd)
}

/**
 * Textarea with `@`-triggered file-path completion and content-driven height.
 *
 * Extracted from NewSpec so Chat can reuse it: keeping one copy is what keeps the
 * popup's active-item styling (and the IME/Enter precedence) consistent in both.
 */
export const MentionTextarea: Component<MentionTextareaProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [items, setItems] = createSignal<CompletionItem[]>([])
  const [index, setIndex] = createSignal(0)
  /** Popup is open on a `/` query that matched nothing. */
  const [slashEmpty, setSlashEmpty] = createSignal(false)

  let el: HTMLTextAreaElement | undefined
  let itemRefs: (HTMLLIElement | null)[] = []
  let mentionStart = -1
  let mentionQuery = ''
  let slashQuery = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let blurTimer: ReturnType<typeof setTimeout> | null = null

  const autosize = () => props.autosize !== false
  const minRows = () => props.minRows ?? DEFAULT_MIN_ROWS
  const maxRows = () => props.maxRows ?? DEFAULT_MAX_ROWS

  onCleanup(() => {
    if (timer) clearTimeout(timer)
    if (blurTimer) clearTimeout(blurTimer)
  })

  /** Grow with the content, clamped to [minRows, maxRows]; scroll past the cap. */
  function autoResize(): void {
    if (!el || !autosize()) return
    const cs = getComputedStyle(el)
    const fontSize = parseFloat(cs.fontSize) || 14
    const lineHeight =
      cs.lineHeight === 'normal'
        ? fontSize * NORMAL_LINE_HEIGHT_RATIO
        : parseFloat(cs.lineHeight) || fontSize * NORMAL_LINE_HEIGHT_RATIO
    // border-box: scrollHeight excludes borders, so the bounds must include them.
    const extra =
      parseFloat(cs.paddingTop) +
      parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderBottomWidth)
    const min = lineHeight * minRows() + extra
    const max = lineHeight * maxRows() + extra
    el.style.height = 'auto'
    const next = Math.min(Math.max(el.scrollHeight, min), max)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }

  onMount(autoResize)
  // Covers host-driven resets too — e.g. Chat clearing the box after send().
  createEffect(on(() => props.value, autoResize))

  function closeMention(): void {
    setOpen(false)
    setSlashEmpty(false)
    setItems([])
    setIndex(0)
    mentionStart = -1
    mentionQuery = ''
    slashQuery = ''
    itemRefs = []
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function debouncedSearch(query: string): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      const pid = props.projectId
      if (!pid) return
      try {
        const result = await api.listFiles(pid, query)
        itemRefs = []
        setItems(result.items.map((value) => ({ kind: 'mention', value })))
        setIndex(0)
      } catch {
        setItems([])
      }
    }, SEARCH_DEBOUNCE_MS)
  }

  function checkSlashCommand(target: HTMLTextAreaElement): boolean {
    const commands = props.slashCommands ?? []
    if (commands.length === 0) return false
    const pos = target.selectionStart
    const text = target.value.slice(0, pos)
    if (!/^\/[\w-]*$/.test(text)) return false

    mentionStart = -1
    mentionQuery = ''
    slashQuery = text.slice(1)
    const next = filterSlashCommands(commands, slashQuery).map((cmd) => ({
      kind: 'slash' as const,
      value: cmd.value,
      label: cmd.label ?? cmd.value,
      description: cmd.description,
      replacement: cmd.replacement,
      action: cmd.action,
      customId: cmd.customId,
      deletable: cmd.deletable,
      deleteLabel: cmd.deleteLabel,
      icon: cmd.icon,
      command: cmd,
    }))
    itemRefs = []
    setItems(next)
    setIndex(0)
    if (next.length > 0) {
      setSlashEmpty(false)
      setOpen(true)
    } else if (props.slashEmptyLabel) {
      setSlashEmpty(true)
      setOpen(true)
    } else {
      closeMention()
    }
    return true
  }

  /** An `@` only opens the popup at a word boundary, and only while the run after
   *  it still looks like a path fragment. */
  function checkMention(target: HTMLTextAreaElement): void {
    const pos = target.selectionStart
    const text = target.value.slice(0, pos)
    const atIdx = text.lastIndexOf('@')
    if (atIdx === -1) {
      closeMention()
      return
    }
    if (atIdx > 0 && !/\s/.test(text[atIdx - 1])) {
      closeMention()
      return
    }
    const afterAt = text.slice(atIdx + 1)
    if (!/^[\w./@-]*$/.test(afterAt)) {
      closeMention()
      return
    }
    mentionStart = atIdx
    mentionQuery = afterAt
    if (!open()) setOpen(true)
    debouncedSearch(afterAt)
  }

  function checkCompletion(target: HTMLTextAreaElement): void {
    if (checkSlashCommand(target)) return
    checkMention(target)
  }

  function selectItem(item: CompletionItem): void {
    if (item.kind === 'slash' && item.action === 'add') {
      const text = props.value
      const after = text.slice(1 + slashQuery.length)
      props.onValueChange(after)
      closeMention()
      props.onSlashCommandAction?.(item.command)
      requestAnimationFrame(() => el?.focus())
      return
    }
    const text = props.value
    const isSlash = item.kind === 'slash'
    const start = isSlash ? 0 : mentionStart
    const queryLength = isSlash ? slashQuery.length : mentionQuery.length
    const before = text.slice(0, start)
    const after = text.slice(start + 1 + queryLength)
    const replacement = isSlash ? (item.replacement ?? `${item.value} `) : `@${item.value}`
    props.onValueChange(before + replacement + after)
    closeMention()
    const cursorPos = before.length + replacement.length
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(cursorPos, cursorPos)
      autoResize()
    })
  }

  function deleteSlashItem(item: CompletionItem): void {
    if (item.kind !== 'slash') return
    props.onDeleteSlashCommand?.(item.command)
    let shouldClose = false
    setItems((prev) => {
      const next = prev.filter((candidate) => {
        return candidate.kind !== 'slash' || !item.customId || candidate.customId !== item.customId
      })
      setIndex((current) => Math.min(current, Math.max(0, next.length - 1)))
      shouldClose = next.length === 0
      return next
    })
    if (shouldClose) closeMention()
  }

  function scrollActiveIntoView(): void {
    itemRefs[index()]?.scrollIntoView({ block: 'nearest' })
  }

  function onKeyDown(e: KeyboardEvent): void {
    const list = items()
    if (open() && list.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndex((i) => (i + 1) % list.length)
        requestAnimationFrame(scrollActiveIntoView)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex((i) => (i - 1 + list.length) % list.length)
        requestAnimationFrame(scrollActiveIntoView)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        // An IME candidate-confirming Enter must not pick a mention (nor, for the
        // host, send the message) — let the composition swallow it.
        if (!e.isComposing) {
          e.preventDefault()
          selectItem(list[index()]!)
          return
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        closeMention()
        return
      }
    }
    props.onKeyDown?.(e)
  }

  return (
    <div class="relative w-full">
      <Textarea
        ref={el}
        rows={props.rows}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        required={props.required}
        autofocus={props.autofocus}
        class={cn(autosize() && 'resize-none', props.class)}
        onInput={(e) => {
          props.onValueChange(e.currentTarget.value)
          checkCompletion(e.currentTarget)
          autoResize()
        }}
        onKeyDown={onKeyDown}
        onPaste={(e) => props.onPaste?.(e)}
        onBlur={() => {
          if (blurTimer) clearTimeout(blurTimer)
          blurTimer = setTimeout(closeMention, BLUR_CLOSE_DELAY_MS)
        }}
      />
      <Show when={open() && (items().length > 0 || slashEmpty())}>
        <ul class="absolute bottom-full left-0 right-0 z-[100] m-0 max-h-60 list-none overflow-y-auto rounded-lg border bg-card py-1 shadow-lg">
          <Show when={slashEmpty()}>
            <li class="px-3 py-1.5 text-sm text-muted-foreground">{props.slashEmptyLabel}</li>
          </Show>
          <For each={items()}>
            {(item, i) => (
              // The row highlight lives on the <li> so the delete control can be a
              // real sibling <button> — nesting one inside the select button was
              // invalid HTML, which is why it used to be a <span role="button">.
              <li
                ref={(node) => (itemRefs[i()] = node)}
                class={cn(
                  'flex items-center',
                  index() === i()
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                )}
                onMouseEnter={() => setIndex(i())}
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
                          index() === i() ? 'text-primary-foreground/80' : 'text-muted-foreground',
                        )}
                      >
                        {item.kind === 'slash' ? item.description : ''}
                      </span>
                    </Show>
                  </span>
                </button>
                <Show when={item.kind === 'slash' && item.deletable}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    tabIndex={-1}
                    title={item.kind === 'slash' ? item.deleteLabel : undefined}
                    class={cn(
                      'mr-1 h-7 w-7 shrink-0 p-0',
                      index() === i()
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
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
