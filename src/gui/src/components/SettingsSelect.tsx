import { For, type Component } from 'solid-js'

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
}> = (props) => (
  <label class="flex flex-col gap-1.5 font-medium">
    <span>{props.label}</span>
    <select
      class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      <For each={props.options}>
        {(option) => <option value={option.value}>{option.label}</option>}
      </For>
    </select>
  </label>
)
