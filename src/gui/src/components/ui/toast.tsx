import { toaster as kobalteToaster } from '@kobalte/core'
import { Toast as ToastPrimitive } from '@kobalte/core/toast'
import { CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-solid'
import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import { cn } from '../../lib/cn.js'
import { t } from '../../i18n/index.js'

type ToastType = 'default' | 'success' | 'info' | 'warning' | 'error' | 'loading'
type ToastContent = JSX.Element | string
type ToastPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'

type ToastOptions = {
  description?: ToastContent
  duration?: number
  persistent?: boolean
  priority?: 'high' | 'low'
  region?: string
}

type ToasterProps = {
  position?: ToastPosition
  duration?: number
  visibleToasts?: number
  class?: string
}

type ToastItemProps = {
  toastId: number
  type: ToastType
  title: ToastContent
  description?: ToastContent
  duration?: number
  persistent?: boolean
  priority?: 'high' | 'low'
}

const positionClasses: Record<ToastPosition, string> = {
  'top-left': 'left-0 top-0 items-start',
  'top-right': 'right-0 top-0 items-end',
  'bottom-left': 'bottom-0 left-0 items-start',
  'bottom-right': 'bottom-0 right-0 items-end',
  'top-center': 'left-0 right-0 top-0 items-center',
  'bottom-center': 'bottom-0 left-0 right-0 items-center',
}

// 语义 token 驱动：亮/暗两套取值由 app.css 的 --success/--info/--warning/--destructive 提供，
// 不再按调色板逐档写 dark: 变体。
const typeClasses: Record<ToastType, string> = {
  default: 'border-border',
  success: 'border-success/40 text-success',
  info: 'border-info/40 text-info',
  warning: 'border-warning/40 text-warning',
  error: 'border-destructive/40 text-destructive',
  loading: 'border-border',
}

function ToastIcon(props: { type: ToastType }) {
  switch (props.type) {
    case 'success':
      return <CircleCheck class="h-4 w-4" />
    case 'info':
      return <Info class="h-4 w-4" />
    case 'warning':
    case 'error':
      return <TriangleAlert class="h-4 w-4" />
    case 'loading':
      return <LoaderCircle class="h-4 w-4 animate-spin" />
    default:
      return null
  }
}

function ToastItem(props: ToastItemProps) {
  return (
    <ToastPrimitive
      toastId={props.toastId}
      duration={props.duration}
      persistent={props.persistent}
      priority={props.priority}
      class={cn(
        'pointer-events-auto relative inline-flex w-fit max-w-[calc(100vw-2rem)] items-start gap-3 overflow-hidden rounded-md border bg-background px-4 py-3 text-sm text-foreground shadow-lg outline-none',
        'data-[closed]:animate-out data-[opened]:animate-in data-[closed]:fade-out-0 data-[opened]:fade-in-0 data-[closed]:zoom-out-95 data-[opened]:zoom-in-95',
        'data-[swipe=move]:translate-x-[var(--kb-toast-swipe-move-x)] data-[swipe=move]:translate-y-[var(--kb-toast-swipe-move-y)] data-[swipe=move]:transition-none',
        'data-[swipe=end]:animate-out data-[swipe=end]:fade-out-0 sm:max-w-md',
      )}
    >
      <div class={cn('shrink-0 self-center', typeClasses[props.type])}>
        <ToastIcon type={props.type} />
      </div>
      <div class="min-w-0">
        <ToastPrimitive.Title class="font-medium leading-5">{props.title}</ToastPrimitive.Title>
        {props.description ? (
          <ToastPrimitive.Description class="mt-1 max-w-[22rem] leading-5 text-muted-foreground">
            {props.description}
          </ToastPrimitive.Description>
        ) : null}
      </div>
      <ToastPrimitive.CloseButton
        class="ml-2 inline-flex h-5 w-5 shrink-0 self-center items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-[opacity,box-shadow] hover:opacity-100 focus:outline-none focus:ring-[1.5px] focus:ring-ring"
        aria-label={t('common.close')}
      >
        <X class="h-4 w-4" />
      </ToastPrimitive.CloseButton>
    </ToastPrimitive>
  )
}

function showToast(type: ToastType, title: ToastContent, options: ToastOptions = {}): number {
  return kobalteToaster.show(
    (props) => (
      <ToastItem
        toastId={props.toastId}
        type={type}
        title={title}
        description={options.description}
        duration={options.duration}
        persistent={options.persistent}
        priority={options.priority}
      />
    ),
    { region: options.region },
  )
}

export const toast = Object.assign(
  (title: ToastContent, options?: ToastOptions) => showToast('default', title, options),
  {
    success: (title: ToastContent, options?: ToastOptions) => showToast('success', title, options),
    info: (title: ToastContent, options?: ToastOptions) => showToast('info', title, options),
    warning: (title: ToastContent, options?: ToastOptions) => showToast('warning', title, options),
    error: (title: ToastContent, options?: ToastOptions) => showToast('error', title, options),
    loading: (title: ToastContent, options?: ToastOptions) => showToast('loading', title, options),
    dismiss: (id?: number) => {
      if (typeof id === 'number') return kobalteToaster.dismiss(id)
      kobalteToaster.clear()
      return undefined
    },
  },
)

export const Toaster = (props: ToasterProps) => {
  const [local, rest] = splitProps(props, ['position', 'duration', 'visibleToasts', 'class'])

  return (
    <ToastPrimitive.Region
      duration={local.duration ?? 5000}
      limit={local.visibleToasts ?? 3}
      swipeDirection="right"
      class={cn(
        '!pointer-events-none fixed z-[100] flex max-h-screen w-full flex-col gap-2 p-4 sm:p-6',
        positionClasses[local.position ?? 'bottom-right'],
        local.class,
      )}
      {...rest}
    >
      <ToastPrimitive.List class="flex w-fit max-w-full flex-col gap-2 outline-none" />
    </ToastPrimitive.Region>
  )
}
