import { cn } from '@/lib/cn'
import type {
  DropdownMenuContentProps,
  DropdownMenuItemProps,
  DropdownMenuRootProps,
  DropdownMenuSeparatorProps,
} from '@kobalte/core/dropdown-menu'
import { DropdownMenu as DropdownMenuPrimitive } from '@kobalte/core/dropdown-menu'
import type { PolymorphicProps } from '@kobalte/core/polymorphic'
import type { ComponentProps, ValidComponent } from 'solid-js'
import { mergeProps, splitProps } from 'solid-js'

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group
export const DropdownMenuSub = DropdownMenuPrimitive.Sub
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

export const DropdownMenu = (props: DropdownMenuRootProps) => {
  const merge = mergeProps<DropdownMenuRootProps[]>({ gutter: 4, flip: false }, props)
  return <DropdownMenuPrimitive {...merge} />
}

type dropdownMenuContentProps<T extends ValidComponent = 'div'> = DropdownMenuContentProps<T> & {
  class?: string
}

export const DropdownMenuContent = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, dropdownMenuContentProps<T>>,
) => {
  const [local, rest] = splitProps(props as dropdownMenuContentProps, ['class'])

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        class={cn(
          'min-w-8rem z-50 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95',
          local.class,
        )}
        {...rest}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

type dropdownMenuItemProps<T extends ValidComponent = 'div'> = DropdownMenuItemProps<T> & {
  class?: string
  inset?: boolean
}

export const DropdownMenuItem = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, dropdownMenuItemProps<T>>,
) => {
  const [local, rest] = splitProps(props as dropdownMenuItemProps, ['class', 'inset'])

  return (
    <DropdownMenuPrimitive.Item
      class={cn(
        'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        local.inset && 'pl-8',
        local.class,
      )}
      {...rest}
    />
  )
}

type dropdownMenuSeparatorProps<T extends ValidComponent = 'hr'> = DropdownMenuSeparatorProps<T> & {
  class?: string
}

export const DropdownMenuSeparator = <T extends ValidComponent = 'hr'>(
  props: PolymorphicProps<T, dropdownMenuSeparatorProps<T>>,
) => {
  const [local, rest] = splitProps(props as dropdownMenuSeparatorProps, ['class'])
  return <DropdownMenuPrimitive.Separator class={cn('-mx-1 my-1 h-px bg-muted', local.class)} {...rest} />
}

export const DropdownMenuShortcut = (props: ComponentProps<'span'>) => {
  const [local, rest] = splitProps(props, ['class'])
  return <span class={cn('ml-auto text-xs tracking-widest opacity-60', local.class)} {...rest} />
}
