import { cn } from '@/lib/cn'
import type { ComponentProps } from 'solid-js'
import { splitProps } from 'solid-js'

export const Input = (props: ComponentProps<'input'>) => {
  const [local, rest] = splitProps(props, ['class'])
  return (
    <input
      class={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-shadow file:border-0 file:bg-transparent file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        local.class,
      )}
      {...rest}
    />
  )
}
