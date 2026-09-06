import { cn } from '@/lib/cn'
import type { ButtonRootProps } from '@kobalte/core/button'
import { Button as ButtonPrimitive } from '@kobalte/core/button'
import type { PolymorphicProps } from '@kobalte/core/polymorphic'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import type { ValidComponent } from 'solid-js'
import { splitProps } from 'solid-js'

/**
 * 与桌面端同源的 shadcn-solid 按钮，尺寸档按触摸重新标定：
 * 桌面端 default 是 h-9（36px），在手机上低于 44px 的 iOS HIG 命中区下限，
 * 因此这里整体上抬一档，并用 active: 代替 hover:——移动端没有真正的悬浮态，
 * 只写 hover 会导致点完之后样式「粘」在按钮上直到点别处。
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-[color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 select-none touch-manipulation',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow active:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm active:bg-destructive/90',
        outline: 'border border-input bg-background shadow-sm active:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm active:bg-secondary/80',
        ghost: 'active:bg-accent active:text-accent-foreground',
        link: 'text-primary underline-offset-4 active:underline',
      },
      size: {
        default: 'h-11 px-4 py-2',
        sm: 'h-9 rounded-md px-3 text-sm',
        lg: 'h-12 rounded-md px-8 text-base',
        // 图标按钮做成正方形命中区，视觉图标自己控制大小
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type buttonProps<T extends ValidComponent = 'button'> = ButtonRootProps<T> &
  VariantProps<typeof buttonVariants> & {
    class?: string
  }

export const Button = <T extends ValidComponent = 'button'>(
  props: PolymorphicProps<T, buttonProps<T>>,
) => {
  const [local, rest] = splitProps(props as buttonProps, ['class', 'variant', 'size'])

  return (
    <ButtonPrimitive
      class={cn(
        buttonVariants({
          size: local.size,
          variant: local.variant,
        }),
        local.class,
      )}
      {...rest}
    />
  )
}
