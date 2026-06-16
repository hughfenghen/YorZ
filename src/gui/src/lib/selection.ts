export interface SelectionSnapshot {
  text: string
  rect: DOMRect
  sectionPath: string
}

export type SelectionCallback = (snap: SelectionSnapshot | null) => void

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
  options: { throttleMs?: number } = {},
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
      const sectionPath = heading ? heading.textContent?.trim() || '(无章节)' : '(无章节)'
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
