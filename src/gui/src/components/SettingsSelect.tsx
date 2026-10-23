import { createMemo, type Component } from 'solid-js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx'

export interface SettingsSelectOption {
  value: string
  label: string
}

export const SettingsSelect: Component<{
  label: string
  value: string
  options: readonly SettingsSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
}> = (props) => {
  const selected = createMemo(
    () => props.options.find((option) => option.value === props.value) ?? null,
  )
  const placeholder = createMemo(() => props.options.find((option) => option.value === '')?.label)

  return (
    <div class="flex flex-col gap-1.5 font-medium">
      <span>{props.label}</span>
      <Select<SettingsSelectOption>
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
          <SelectValue<SettingsSelectOption> class="min-w-0 flex-1 truncate text-left">
            {(state) => state.selectedOption().label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
    </div>
  )
}
