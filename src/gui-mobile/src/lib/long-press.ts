import { onCleanup } from 'solid-js'

interface LongPressOptions {
  /** 长按达成时触发。 */
  onLongPress: () => void
  /** 普通点击（未达成长按）时触发，写在这里而不是元素自己的 onClick 上，见下方说明。 */
  onClick?: () => void
  /** 判定时长，默认 500ms —— 与两大移动端系统的上下文菜单手感一致。 */
  ms?: number
  /** 判定期间允许的手指位移，超过即视为滚动意图，默认 10px。 */
  moveTolerance?: number
}

/**
 * 长按手势。返回一组可直接展开到元素上的事件处理器：`<button {...createLongPress(...)}>`。
 *
 * 三个容易漏掉的点，都在这里一次性处理掉：
 * 1. **抑制后续 click**：长按松手浏览器照样派发 click，不拦的话菜单弹出的同时
 *    行自己的点击行为也会跑一遍（在 Specs 上就是「即将支持」toast 跟着一起冒）。
 *    所以点击回调必须交给这里托管，由它决定这一次 click 要不要放行。
 * 2. **拦 contextmenu**：Android Chrome 长按会弹系统菜单，不 preventDefault 就会
 *    盖在自绘面板上面。
 * 3. **位移与 pointercancel 取消**：列表是可滚动的，手指按住后一滑就该判定为滚动。
 */
export function createLongPress(options: LongPressOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let origin: { x: number; y: number } | null = null
  let fired = false

  let guardTimer: ReturnType<typeof setTimeout> | undefined

  const suppressContextMenu = (e: Event) => e.preventDefault()

  const disarmGuard = () => {
    if (guardTimer) clearTimeout(guardTimer)
    guardTimer = undefined
    document.removeEventListener('contextmenu', suppressContextMenu, true)
  }

  /**
   * 长按判定成立后系统菜单还会晚一拍才到，而那时命中的多半是刚渲染出来的面板/遮罩——
   * 元素自己的 onContextMenu 已经够不着它。于是在 document 上以捕获方式挂一个短命拦截器，
   * 只盖住这一拍：常驻禁用 contextmenu 会把输入框等处的正常长按行为一并废掉。
   */
  const armGuard = () => {
    disarmGuard()
    document.addEventListener('contextmenu', suppressContextMenu, true)
    guardTimer = setTimeout(disarmGuard, 700)
  }

  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    origin = null
  }

  onCleanup(() => {
    cancel()
    disarmGuard()
  })

  return {
    onPointerDown: (e: PointerEvent) => {
      // 只认主按键：鼠标右键在桌面浏览器里本来就有原生菜单
      if (e.button !== 0) return
      fired = false
      origin = { x: e.clientX, y: e.clientY }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        origin = null
        fired = true
        armGuard()
        options.onLongPress()
      }, options.ms ?? 500)
    },
    onPointerMove: (e: PointerEvent) => {
      if (!origin) return
      const tol = options.moveTolerance ?? 10
      if (Math.abs(e.clientX - origin.x) > tol || Math.abs(e.clientY - origin.y) > tol) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: Event) => e.preventDefault(),
    onClick: (e: MouseEvent) => {
      if (fired) {
        fired = false
        e.preventDefault()
        e.stopPropagation()
        return
      }
      options.onClick?.()
    },
  }
}
