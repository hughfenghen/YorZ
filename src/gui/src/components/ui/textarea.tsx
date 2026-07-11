import { cn } from '@/lib/cn'
import type { ComponentProps } from 'solid-js'
import { splitProps } from 'solid-js'

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
