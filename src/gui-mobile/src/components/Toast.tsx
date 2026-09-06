import { Show, createSignal, onCleanup, type Component } from 'solid-js'
import { cn } from '@/lib/cn'

/**
 * 极简 toast：同时只显示一条，浮在底部导航之上，3s 自动消失。
 *
 * 刻意没有引进桌面端那套 Kobalte Toaster：移动端目前只有两类用途——
 * 未实现二级入口的「即将支持」提示、脚本重启/终止的成功与失败反馈，
 * 都不需要队列、动作按钮和可访问性 region 的完整实现。
 * 后续真出现并发多条的场景，再整体换掉这一个文件即可。
 */

const DURATION_MS = 3000

export type ToastTone = 'default' | 'error'

interface ToastState {
  message: string
  tone: ToastTone
  /** 单调递增，用来让「同样文案连点两次」也能重置计时并触发重渲染。 */
  seq: number
}

const [toast, setToast] = createSignal<ToastState | null>(null)
let seq = 0

/** 弹一条提示。后到的覆盖先到的，不排队。 */
export function showToast(message: string, tone: ToastTone = 'default'): void {
  seq += 1
  setToast({ message, tone, seq })
}

export const Toaster: Component = () => {
  let timer: ReturnType<typeof setTimeout> | undefined

  // 每次 toast 变化都重置计时器：后到的消息拿满整个 3s，而不是继承上一条的余额。
  const scheduleDismiss = (state: ToastState | null) => {
    if (timer) clearTimeout(timer)
    if (!state) return
    timer = setTimeout(() => {
      // 只有当前这条还在时才关闭，避免关掉一条更新的消息
      setToast((cur) => (cur?.seq === state.seq ? null : cur))
    }, DURATION_MS)
  }

  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  return (
    <Show when={toast()} keyed>
      {(state) => {
        scheduleDismiss(state)
        return (
          <div
            // pointer-events-none：提示不该挡住底下的列表点击
            class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-safe pb-safe"
            role="status"
            aria-live="polite"
          >
            {/* bottom-14 的等价物：底部导航 h-14，提示浮在它上方留一点呼吸 */}
            <div
              class={cn(
                'mb-[4.25rem] max-w-[85%] rounded-lg px-4 py-2.5 text-sm shadow-lg',
                state.tone === 'error'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-foreground text-background',
              )}
            >
              {state.message}
            </div>
          </div>
        )
      }}
    </Show>
  )
}
