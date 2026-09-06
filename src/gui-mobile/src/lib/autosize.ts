/**
 * 文本域自增高：1 行起，长到 `maxRows` 行封顶，封顶前不出现滚动条。
 *
 * 尺寸全部从 `getComputedStyle` 现算，不在调用点硬编码 24/16 之类的数字——
 * 会话输入框（`py-2.5`）与 Git 提交框（`py-2`）内边距本来就不同，
 * 硬编码只会让第二个调用点再错一次。
 */

/** 行高解析失败（`normal`）时的兜底：与移动端 `leading-6` 一致。 */
const FALLBACK_LINE_HEIGHT = 24

function px(value: string, fallback = 0): number {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 把 `el` 的高度贴合内容，最多 `maxRows` 行。
 *
 * 两处细节决定成败：
 * 1. 先把 `height` 清成 `auto`——不清的话上一次撑开的高度会成为 `scrollHeight`
 *    的下界，文本删短后再也收不回去。
 * 2. 写回的高度必须**补上 border**。Tailwind preflight 把盒模型设成
 *    `border-box`，而 `scrollHeight` 只含内容 + 内边距；直接写 `scrollHeight`
 *    会让内容盒比内容本身矮一个边框，于是任何行数下都恒定溢出、滚动条常驻。
 */
export function autoSizeTextarea(el: HTMLTextAreaElement, maxRows: number): void {
  const style = window.getComputedStyle(el)
  const lineHeight = px(style.lineHeight, FALLBACK_LINE_HEIGHT) || FALLBACK_LINE_HEIGHT
  const padding = px(style.paddingTop) + px(style.paddingBottom)
  const border = px(style.borderTopWidth) + px(style.borderBottomWidth)

  el.style.height = 'auto'
  const content = Math.max(el.scrollHeight - padding, lineHeight)
  const maxContent = lineHeight * maxRows
  const clamped = content > maxContent

  el.style.height = `${(clamped ? maxContent : content) + padding + border}px`
  // 未封顶时显式关掉滚动：只靠高度合适仍会因为 1px 的取整误差冒出滚动条。
  el.style.overflowY = clamped ? 'auto' : 'hidden'
}
