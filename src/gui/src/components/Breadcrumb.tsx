import { For, Show, type Component } from 'solid-js'
import { A } from '@solidjs/router'
import { ChevronRight } from 'lucide-solid'

export interface BreadcrumbItem {
  label: string
  href?: string
}

export const Breadcrumb: Component<{ items: BreadcrumbItem[] }> = (props) => {
  return (
    <nav class="flex items-center gap-1 text-muted-foreground" aria-label="breadcrumb">
      <For each={props.items}>
        {(item, i) => (
          <>
            <Show when={i() > 0}>
              <ChevronRight class="h-3.5 w-3.5 shrink-0 opacity-60" />
            </Show>
            <Show
              when={item.href}
              fallback={<span class="truncate font-medium text-foreground">{item.label}</span>}
            >
              <A class="truncate cursor-pointer hover:text-foreground" href={item.href!}>
                {item.label}
              </A>
            </Show>
          </>
        )}
      </For>
    </nav>
  )
}
