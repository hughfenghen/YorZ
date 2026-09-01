import { createSignal, onCleanup } from 'solid-js'

export interface VisualViewportState {
  offsetTop: number
  offsetLeft: number
  /** 可视视口高度（键盘弹出时小于 innerHeight）。 */
  height: number
  /** 软键盘是否处于弹出态（可视高度较布局视口缩小超过阈值）。 */
  keyboardOpen: boolean
}

/** 可视高度较布局视口缩小超过该阈值（px）才视为键盘弹出，过滤地址栏收缩等噪声。 */
const KEYBOARD_THRESHOLD = 120

function readState(): VisualViewportState {
  const vv = typeof window !== 'undefined' ? window.visualViewport : undefined
  if (!vv) {
    return {
      offsetTop: 0,
      offsetLeft: 0,
      height: typeof window !== 'undefined' ? window.innerHeight : 0,
      keyboardOpen: false,
    }
  }
  return {
    offsetTop: vv.offsetTop,
    offsetLeft: vv.offsetLeft,
    height: vv.height,
    keyboardOpen: window.innerHeight - vv.height > KEYBOARD_THRESHOLD,
  }
}

/**
 * 响应式可视视口状态：键盘弹出 / 收起、用户平移可视视口时更新。
 * 供 fixed 浮层（对话框 / 批注框）按可视视口矩形重新钳制定位。
 */
export function createVisualViewport(): () => VisualViewportState {
  const [state, setState] = createSignal(readState())
  if (typeof window === 'undefined') return state
  const vv = window.visualViewport
  const update = (): void => {
    setState(readState())
  }
  if (vv) {
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    onCleanup(() => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    })
  } else {
    // 旧浏览器无 visualViewport：退化为监听窗口 resize，保持高度不过期。
    window.addEventListener('resize', update)
    onCleanup(() => window.removeEventListener('resize', update))
  }
  return state
}

function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return true
  return el instanceof HTMLElement && el.isContentEditable
}

/** 聚焦元素是否完整落在可视视口内。 */
export function isElementInVisualViewport(el: HTMLElement): boolean {
  const vv = window.visualViewport
  if (!vv) return true
  const rect = el.getBoundingClientRect()
  return (
    rect.top >= vv.offsetTop &&
    rect.bottom <= vv.offsetTop + vv.height &&
    rect.left >= vv.offsetLeft &&
    rect.right <= vv.offsetLeft + vv.width
  )
}

/**
 * 把当前聚焦的文本输入滚进可视视口（仅对流内元素有效；fixed 元素不随滚动，
 * 需由调用方按可视视口重定位）。配合 focusin / visualViewport resize 使用，
 * 解决移动端软键盘遮挡输入区的问题。
 */
export function ensureFocusedVisible(): void {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !isTextEntry(active)) return
  if (isElementInVisualViewport(active)) return
  active.scrollIntoView({ block: 'center' })
}
