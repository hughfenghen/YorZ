import { For, Show, type Component } from 'solid-js'
import { Check } from 'lucide-solid'
import { statusTone } from '@shared/lib/git-changes.js'
import { cn } from '@/lib/cn'

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

/** File rows shared by the mobile working-tree and commit-history pages. */
export const GitFileList: Component<GitFileListProps> = (props) => (
  <For each={props.files}>
    {(file) => (
      <div class="flex items-center active:bg-accent">
        <Show when={props.selectedPaths && props.onToggle}>
          <button
            type="button"
            class="flex size-11 shrink-0 items-center justify-center"
            role="checkbox"
            aria-checked={props.selectedPaths?.has(file.path) ?? false}
            aria-label={file.path}
            disabled={props.disabled}
            onClick={() => props.onToggle?.(file.path)}
          >
            <span
              class={cn(
                'flex h-5 w-5 items-center justify-center rounded border',
                props.selectedPaths?.has(file.path)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border',
              )}
            >
              <Show when={props.selectedPaths?.has(file.path)}>
                <Check size={14} aria-hidden="true" />
              </Show>
            </span>
          </button>
        </Show>
        <button
          type="button"
          class={cn(
            'flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 pr-4 text-left',
            !props.selectedPaths && 'pl-4',
            props.activePath === file.path && 'bg-accent',
          )}
          onClick={() => props.onSelect(file.path)}
          title={file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path}
        >
          <span class={cn('w-6 shrink-0 text-center text-xs font-bold', statusTone(file.status))}>
            {file.status}
          </span>
          <span class="truncate-start min-w-0 flex-1 font-mono text-xs">
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
