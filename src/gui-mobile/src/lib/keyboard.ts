import { onCleanup } from 'solid-js'

/**
 * 软键盘占位，只为 iOS Safari 存在。
 *
 * Android/Chrome 由 index.html 的 `interactive-widget=resizes-content` 处理：
 * 浏览器直接压缩布局视口，`100dvh` 变小，输入栏自然停在键盘之上，这里算出的
 * 差值恒为 0。Safari 不认该属性——键盘弹出时布局视口纹丝不动，只有
 * `visualViewport` 缩小，不补这段的话输入栏会被整块盖住。
 *
 * 被否决的备选是 focus 时 `scrollIntoView()`：它只能把输入框滚进视口一次，
 * 键盘收起、或中文候选词条改变键盘高度时会再次错位，且无法恢复。
 */
export function watchKeyboardInset(): void {
  const vv = window.visualViewport
  if (!vv) return

  const root = document.documentElement

  const update = () => {
    // 键盘遮住的高度 = 布局视口底 − 可视视口底。`offsetTop` 是 Safari 在页面被
    // 顶起时的偏移量，不减掉它会在滚动到底部时算出虚高。
    const hidden = window.innerHeight - vv.height - vv.offsetTop
    // 负值（橡皮筋回弹）与亚像素抖动都归零：只在真的有遮挡时才占位。
    const inset = hidden > 1 ? Math.round(hidden) : 0
    root.style.setProperty('--kb-inset', `${inset}px`)
  }

  update()
  vv.addEventListener('resize', update)
  // 键盘弹出后页面常被 Safari 整体上推，此时 height 不变、offsetTop 变，
  // 只听 resize 会漏掉这一路。
  vv.addEventListener('scroll', update)
  onCleanup(() => {
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
    root.style.removeProperty('--kb-inset')
  })
}
