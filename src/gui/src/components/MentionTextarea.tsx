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
import { cn } from '../lib/cn.js'
import { api } from '../lib/api.js'
import { Textarea } from './ui/textarea.jsx'

const SEARCH_DEBOUNCE_MS = 150
/** Blur must outlive the候选项 mousedown, or the click never lands. */
const BLUR_CLOSE_DELAY_MS = 150
const DEFAULT_MIN_ROWS = 2
const DEFAULT_MAX_ROWS = 10
/** getComputedStyle returns `normal` for an unset line-height. */
const NORMAL_LINE_HEIGHT_RATIO = 1.5

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
 */
export const MentionTextarea: Component<MentionTextareaProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [items, setItems] = createSignal<string[]>([])
  const [index, setIndex] = createSignal(0)

  let el: HTMLTextAreaElement | undefined
  let itemRefs: (HTMLLIElement | null)[] = []
  let mentionStart = -1
  let mentionQuery = ''
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
    setItems([])
    setIndex(0)
    mentionStart = -1
    mentionQuery = ''
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
        setItems(result.items)
        setIndex(0)
      } catch {
        setItems([])
      }
    }, SEARCH_DEBOUNCE_MS)
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

  function selectMention(path: string): void {
    const text = props.value
    const before = text.slice(0, mentionStart)
    const after = text.slice(mentionStart + 1 + mentionQuery.length)
    const replacement = `@${path}`
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
          selectMention(list[index()]!)
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
          checkMention(e.currentTarget)
          autoResize()
        }}
        onKeyDown={onKeyDown}
        onPaste={(e) => props.onPaste?.(e)}
        onBlur={() => {
          if (blurTimer) clearTimeout(blurTimer)
          blurTimer = setTimeout(closeMention, BLUR_CLOSE_DELAY_MS)
        }}
      />
      <Show when={open() && items().length > 0}>
        <ul class="absolute bottom-full left-0 right-0 z-[100] m-0 max-h-60 list-none overflow-y-auto rounded-lg border bg-card py-1 shadow-lg">
          <For each={items()}>
            {(item, i) => (
              <li ref={(node) => (itemRefs[i()] = node)}>
                <button
                  type="button"
                  title={item}
                  // cn() (tailwind-merge) is load-bearing: a hand-joined string kept
                  // `bg-transparent` alongside `bg-primary`, and CSS order decided the
                  // winner — the active row rendered white-on-white.
                  class={cn(
                    'block w-full overflow-hidden text-ellipsis whitespace-nowrap border-0 px-3 py-1.5 text-left text-sm',
                    index() === i()
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                  onMouseEnter={() => setIndex(i())}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectMention(item)
                  }}
                >
                  {item}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
