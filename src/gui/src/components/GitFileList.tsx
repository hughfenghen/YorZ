import { For, Show, type Component } from 'solid-js'
import { statusTone } from '@shared/lib/git-changes.js'
import { Checkbox, CheckboxControl } from './ui/checkbox.jsx'

export interface GitFileEntry {
  path: string
  status: string
  renamedFrom?: string
}

interface GitFileListProps {
  files: GitFileEntry[]
  activePath?: string | null
  selectedPaths?: ReadonlySet<string>
  disabled?: boolean
  onSelect: (path: string) => void
  onToggle?: (path: string) => void
}

/** File rows shared by the desktop working-tree and commit-history panels. */
export const GitFileList: Component<GitFileListProps> = (props) => (
  <For each={props.files}>
    {(file) => (
      <div
        class={`flex items-center gap-2 px-2 py-0.5 ${
          props.activePath === file.path ? 'bg-accent' : ''
        }`}
      >
        <Show when={props.selectedPaths && props.onToggle}>
          <Checkbox
            checked={props.selectedPaths?.has(file.path) ?? false}
            onChange={() => props.onToggle?.(file.path)}
            disabled={props.disabled}
          >
            <CheckboxControl />
          </Checkbox>
        </Show>
        <button
          type="button"
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
          onClick={() => props.onSelect(file.path)}
          title={file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path}
        >
          <span class={`inline-block w-6 text-center text-sm font-bold ${statusTone(file.status)}`}>
            {file.status}
          </span>
          <span class="truncate font-mono text-sm">
            <Show when={file.renamedFrom}>
              <span class="text-muted-foreground">{file.renamedFrom} → </span>
            </Show>
            {file.path}
          </span>
        </button>
      </div>
    )}
  </For>
)
