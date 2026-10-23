import { Check, ChevronsUpDown } from 'lucide-solid'
import { For, Show, createMemo, createSignal, type Component } from 'solid-js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.jsx'
import { Button } from './ui/button.jsx'
import { Input } from './ui/input.jsx'

export interface AgentSettingsOption {
  value: string
  label: string
}

export const AgentSettings: Component<{
  label: string
  value: string
  options: readonly AgentSettingsOption[]
  onChange: (value: string) => void
  disabled?: boolean
  searchable?: boolean
  filterPlaceholder?: string
  emptyText?: string
}> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const selected = createMemo(
    () => props.options.find((option) => option.value === props.value) ?? null,
  )
  const placeholder = createMemo(() => props.options.find((option) => option.value === '')?.label)
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

  const choose = (value: string) => {
    props.onChange(value)
    setOpen(false)
  }

  return (
    <div class="flex flex-col gap-1.5 font-medium">
      <span>{props.label}</span>
      <Show
        when={props.searchable}
        fallback={
          <Select<AgentSettingsOption>
            options={[...props.options]}
            optionValue="value"
            optionTextValue="label"
            value={selected()}
            placeholder={placeholder()}
            disabled={props.disabled}
            // Catalog/config updates rebuild option objects; don't surface Kobalte's
            // same-key collection sync as another user selection.
            allowDuplicateSelectionEvents={false}
            onChange={(option) => {
              if (!option) return
              // Kobalte synchronously invokes this callback before it closes and
              // cleans up the portal. Let that lifecycle finish before a parent
              // signal update changes our controlled value/options.
              queueMicrotask(() => props.onChange(option.value))
            }}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>
            )}
            aria-label={props.label}
          >
            <SelectTrigger class="min-w-0">
              <SelectValue<AgentSettingsOption> class="min-w-0 flex-1 truncate text-left">
                {(state) => state.selectedOption().label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent />
          </Select>
        }
      >
        <Popover
          open={open()}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) setQuery('')
          }}
          placement="bottom-start"
        >
          <PopoverTrigger
            as={Button}
            type="button"
            variant="outline"
            class="min-w-0 justify-between gap-2 px-3 font-normal"
            disabled={props.disabled}
            aria-label={props.label}
          >
            <span class="min-w-0 flex-1 truncate text-left">
              {selected()?.label ?? placeholder() ?? props.value}
            </span>
            <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
          </PopoverTrigger>
          <PopoverContent class="w-80 max-w-[calc(100vw-2rem)] p-0" hideCloseButton>
            <div class="border-b p-1">
              <Input
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                placeholder={props.filterPlaceholder}
                class="h-8"
              />
            </div>
            <div class="max-h-64 overflow-y-auto p-1">
              <For each={filteredOptions()}>
                {(option) => (
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    title={option.label}
                    aria-pressed={option.value === props.value}
                    onClick={() => choose(option.value)}
                  >
                    <span class="min-w-0 flex-1 truncate">{option.label}</span>
                    <Check
                      class={`size-4 shrink-0 ${option.value === props.value ? 'opacity-100' : 'opacity-0'}`}
                    />
                  </button>
                )}
              </For>
              <Show when={filteredOptions().length === 0}>
                <p class="m-0 px-2 py-3 text-center text-sm text-muted-foreground">
                  {props.emptyText}
                </p>
              </Show>
            </div>
          </PopoverContent>
        </Popover>
      </Show>
    </div>
  )
}
