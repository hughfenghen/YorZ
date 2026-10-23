import { For, Show, createMemo, createSignal, type Component, type JSX } from 'solid-js'
import { Check, ChevronsUpDown } from 'lucide-solid'
import { cn } from '@/lib/cn'
import { Sheet } from '@/components/Sheet.jsx'

/** 底部抽屉式下拉：按钮行 + Sheet，Agent 相关设置（类型/模型/推理力度）统一用同一交互。 */
export function AgentSettings<T extends string>(props: {
  label: string
  options: readonly { value: T; label: string }[]
  value: () => T
  onChange: (value: T) => void
  disabled?: () => boolean
  /** 抽屉内是否渲染筛选输入框；候选可能超一屏的列表（模型）才值得开。 */
  searchable?: boolean
  filterPlaceholder?: string
  emptyText?: string
}): JSX.Element {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const selected = createMemo(
    () => props.options.find((option) => option.value === props.value()) ?? null,
  )
  const filteredOptions = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase()
    if (!needle) return props.options
    return props.options.filter(
      (option) =>
        option.value === '' ||
        option.label.toLocaleLowerCase().includes(needle) ||
        option.value.toLocaleLowerCase().includes(needle),
    )
  })

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const choose = (value: T) => {
    props.onChange(value)
    close()
  }

  return (
    <>
      <div class="flex items-center justify-between gap-3 px-4 py-3">
        <span class="min-w-0 flex-1 text-sm">{props.label}</span>
        <button
          type="button"
          class="flex min-h-11 min-w-0 max-w-[65%] items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:opacity-60"
          disabled={props.disabled?.()}
          aria-label={props.label}
          onClick={() => setOpen(true)}
        >
          <span class="min-w-0 flex-1 truncate text-left">
            {selected()?.label ?? props.value()}
          </span>
          <ChevronsUpDown class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>

      <Sheet open={open()} title={props.label} onClose={close}>
        <Show when={props.searchable}>
          <input
            type="search"
            class="mb-3 h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
            value={query()}
            placeholder={props.filterPlaceholder}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </Show>
        <Show
          when={filteredOptions().length > 0}
          fallback={<p class="py-6 text-center text-sm text-muted-foreground">{props.emptyText}</p>}
        >
          <ul class="divide-y-[0.5px] divide-border">
            <For each={filteredOptions()}>
              {(option) => (
                <li>
                  <button
                    type="button"
                    class="flex min-h-11 w-full items-center gap-2 py-2 text-left text-sm"
                    title={option.label}
                    aria-pressed={option.value === props.value()}
                    onClick={() => choose(option.value)}
                  >
                    <span class="min-w-0 flex-1 truncate">{option.label}</span>
                    <Show when={option.value === props.value()}>
                      <Check class="size-4 shrink-0 text-primary" aria-hidden="true" />
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Sheet>
    </>
  )
}
