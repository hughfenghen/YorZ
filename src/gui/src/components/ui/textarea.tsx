import { cn } from '@/lib/cn'
import type { ComponentProps, JSX } from 'solid-js'
import { createEffect, on, onMount, splitProps } from 'solid-js'

export const Textarea = (props: ComponentProps<'textarea'>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <textarea
      class={cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 shadow-sm transition-shadow placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        local.class,
      )}
      {...rest}
    />
  )
}

/** getComputedStyle returns `normal` for an unset line-height. */
const NORMAL_LINE_HEIGHT_RATIO = 1.5
const DEFAULT_MIN_ROWS = 2
const DEFAULT_MAX_ROWS = 10

/**
 * Size a textarea to its content, clamped to [minRows, maxRows] lines — past the
 * cap it stops growing and scrolls instead.
 *
 * `scrollHeight` excludes borders while the box is sized border-box, so the
 * bounds have to add padding + borders back in; without that the box ends up a
 * couple of pixels short and scrolls at exactly the row count it should fit.
 * Internal to `AutoResizeTextarea` — sizing is that component's job alone, so
 * hosts stay out of the height business.
 */
function fitTextareaToRows(
  el: HTMLTextAreaElement | undefined,
  minRows: number = DEFAULT_MIN_ROWS,
  maxRows: number = DEFAULT_MAX_ROWS,
): void {
  if (!el) return
  const cs = getComputedStyle(el)
  const fontSize = parseFloat(cs.fontSize) || 14
  const lineHeight =
    cs.lineHeight === 'normal'
      ? fontSize * NORMAL_LINE_HEIGHT_RATIO
      : parseFloat(cs.lineHeight) || fontSize * NORMAL_LINE_HEIGHT_RATIO
  const extra =
    parseFloat(cs.paddingTop) +
    parseFloat(cs.paddingBottom) +
    parseFloat(cs.borderTopWidth) +
    parseFloat(cs.borderBottomWidth)
  const min = lineHeight * minRows + extra
  const max = lineHeight * maxRows + extra
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

export interface AutoResizeTextareaProps extends ComponentProps<'textarea'> {
  /**
   * Height floor in lines. Also the initial `rows`. Defaults to 2.
   * `minRows === maxRows` pins the box to a fixed row count.
   */
  minRows?: number
  /** Height cap in lines; past it the box scrolls. Defaults to 10. */
  maxRows?: number
}

/**
 * A `Textarea` that grows with its content between `minRows` and `maxRows`.
 * Works both controlled (resizes when `value` changes) and uncontrolled
 * (resizes on input).
 */
export const AutoResizeTextarea = (props: AutoResizeTextareaProps) => {
  const [local, rest] = splitProps(props, ['minRows', 'maxRows', 'class', 'ref', 'onInput'])
  let el: HTMLTextAreaElement | undefined

  const resize = (): void => fitTextareaToRows(el, local.minRows, local.maxRows)

  const setRef = (node: HTMLTextAreaElement): void => {
    el = node
    const forwarded = local.ref
    if (typeof forwarded === 'function') (forwarded as (n: HTMLTextAreaElement) => void)(node)
  }

  const handleInput: JSX.InputEventHandler<HTMLTextAreaElement, InputEvent> = (event) => {
    const handler = local.onInput
    if (typeof handler === 'function') handler(event)
    else if (Array.isArray(handler)) handler[0](handler[1], event)
    resize()
  }

  onMount(() => {
    resize()
    // Dialogs and popovers mount through a portal and can still be laying out on
    // the first frame; a second pass picks up the real metrics.
    requestAnimationFrame(resize)
  })
  // Covers host-driven writes too — prefilled edit forms, resets after submit.
  createEffect(on(() => props.value, resize))

  return (
    <Textarea
      ref={setRef}
      // min-h-0 drops the base 60px floor so the row clamp alone owns the height.
      class={cn('min-h-0 resize-none', local.class)}
      rows={local.minRows ?? DEFAULT_MIN_ROWS}
      onInput={handleInput}
      {...rest}
    />
  )
}
