/**
 * 正文选区观察器：把浏览器的 `selectionchange` 折叠成一串「快照或 null」。
 *
 * 纯 DOM、平台无关，两端共用：桌面靠它驱动跟随选区的浮动菜单，移动端靠它
 * 驱动屏幕底部固定条。唯一的本地化依赖 —— 找不到所属章节时的回退文案 ——
 * 由调用方通过 `noSectionLabel` 注入（与 `attachments.ts` 的 `labels` 注入
 * 同一范式），这样本文件不必 import 任一端的 i18n 模块。
 */

export interface SelectionSnapshot {
  text: string
  /** viewport 坐标；滚动后会过期，跟随选区定位的调用方需自行重算。 */
  rect: DOMRect
  sectionPath: string
}

export type SelectionCallback = (snap: SelectionSnapshot | null) => void

export interface ObserveSelectionOptions {
  /** 选区不在任何 H2/H3 之下时的 sectionPath 回退值，必须非空（服务端校验要求）。 */
  noSectionLabel: string
  /**
   * 去抖窗口。桌面鼠标拖选用 50ms 足够；触屏拖动选择把手期间事件频率高得多，
   * 移动端应传更大的值，否则底部条会跟着手指抖。
   */
  throttleMs?: number
}

/**
 * 从选区起点**按文档序反向遍历**，取最近的一个 H2/H3。
 * 正向找父级拿不到章节：markdown 渲染出的是扁平兄弟节点，标题并不包裹正文。
 */
function findSectionHeading(node: Node | null, container: HTMLElement): HTMLElement | null {
  let el: Node | null = node
  while (el && el !== container) {
    if (el.nodeType === 1) {
      const tag = (el as HTMLElement).tagName
      if (tag === 'H2' || tag === 'H3') return el as HTMLElement
    }
    let prev: Node | null = el.previousSibling
    if (!prev) {
      el = el.parentNode
      continue
    }
    // descend into last children of the previous sibling
    while (prev?.lastChild) prev = prev.lastChild
    el = prev
  }
  return null
}

function rangeContainedIn(range: Range, container: HTMLElement): boolean {
  return (
    container.contains(range.startContainer) &&
    container.contains(range.endContainer) &&
    container.contains(range.commonAncestorContainer)
  )
}

export function observeSelection(
  container: HTMLElement,
  cb: SelectionCallback,
  options: ObserveSelectionOptions,
): () => void {
  const throttleMs = options.throttleMs ?? 50
  let timer: number | undefined
  let lastText = ''

  const handler = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        if (lastText !== '') {
          lastText = ''
          cb(null)
        }
        return
      }
      const range = sel.getRangeAt(0)
      if (!rangeContainedIn(range, container)) {
        if (lastText !== '') {
          lastText = ''
          cb(null)
        }
        return
      }
      const text = sel.toString()
      if (!text.trim()) {
        if (lastText !== '') {
          lastText = ''
          cb(null)
        }
        return
      }
      const rect = range.getBoundingClientRect()
      const heading = findSectionHeading(range.startContainer, container)
      const noSection = options.noSectionLabel
      const sectionPath = heading ? heading.textContent?.trim() || noSection : noSection
      lastText = text
      cb({ text, rect, sectionPath })
    }, throttleMs)
  }

  document.addEventListener('selectionchange', handler)
  return () => {
    document.removeEventListener('selectionchange', handler)
    window.clearTimeout(timer)
  }
}
