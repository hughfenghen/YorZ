import { cn } from '@/lib/cn'
import type { PolymorphicProps } from '@kobalte/core/polymorphic'
import { Tabs as TabsPrimitive } from '@kobalte/core/tabs'
import type { TabsContentProps, TabsListProps, TabsTriggerProps } from '@kobalte/core/tabs'
import { splitProps, type ParentProps, type ValidComponent } from 'solid-js'

export const Tabs = TabsPrimitive

export const TabsList = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, ParentProps<TabsListProps<T> & { class?: string }>>,
) => {
  const [local, rest] = splitProps(props as TabsListProps & { class?: string }, ['class'])
  return (
    <TabsPrimitive.List
      class={cn(
        'inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground',
        local.class,
      )}
      {...rest}
    />
  )
}

export const TabsTrigger = <T extends ValidComponent = 'button'>(
  props: PolymorphicProps<T, ParentProps<TabsTriggerProps<T> & { class?: string }>>,
) => {
  const [local, rest] = splitProps(props as TabsTriggerProps & { class?: string }, ['class'])
  return (
    <TabsPrimitive.Trigger
      class={cn(
        'inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm',
        local.class,
      )}
      {...rest}
    />
  )
}

export const TabsContent = <T extends ValidComponent = 'div'>(
  props: PolymorphicProps<T, ParentProps<TabsContentProps<T> & { class?: string }>>,
) => {
  const [local, rest] = splitProps(props as TabsContentProps & { class?: string }, ['class'])
  return (
    <TabsPrimitive.Content
      class={cn(
        'focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring',
        local.class,
      )}
      {...rest}
    />
  )
}
