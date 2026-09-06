import { t } from '../i18n/index.js'
import { renderMermaidCore, type RenderMermaidCleanup } from '@shared/lib/mermaid-core.js'

export type { RenderMermaidCleanup }

interface MermaidControlBinding {
  cleanup: () => void
  button: HTMLButtonElement
}

const mermaidControlBindings = new WeakMap<HTMLElement, MermaidControlBinding>()
let activeMermaidOverlay: {
  host: HTMLElement
  sourceSvg: SVGSVGElement
  close: () => void
} | null = null
const MERMAID_OVERLAY_PADDING = 96
const MERMAID_MIN_SCALE = 0.25
const MERMAID_MAX_SCALE = 8
const MERMAID_MAX_INITIAL_SCALE = 2.5

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatTransformNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function parsePositiveNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getSvgDisplaySize(svg: SVGSVGElement): { width: number; height: number } {
  const rect = svg.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height }
  }

  const viewBox = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (viewBox?.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) {
    return { width: viewBox[2]!, height: viewBox[3]! }
  }

  return {
    width: parsePositiveNumber(svg.getAttribute('width')) ?? 0,
    height: parsePositiveNumber(svg.getAttribute('height')) ?? 0,
  }
}

function getInitialMermaidOverlayScale(
  svgSize: { width: number; height: number },
  viewport: HTMLElement,
): number {
  const rect = viewport.getBoundingClientRect()
  if (svgSize.width <= 0 || svgSize.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return 1
  }

  const usableWidth = Math.max(rect.width - MERMAID_OVERLAY_PADDING, rect.width * 0.5)
  const usableHeight = Math.max(rect.height - MERMAID_OVERLAY_PADDING, rect.height * 0.5)
  const fitScale = Math.min(usableWidth / svgSize.width, usableHeight / svgSize.height)
  return clamp(fitScale, MERMAID_MIN_SCALE, MERMAID_MAX_INITIAL_SCALE)
}

function createIconButton(className: string, label: string, text: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', label)
  button.title = label
  button.textContent = text
  return button
}

function isSvgSvgElement(element: Element): element is SVGSVGElement {
  return typeof SVGSVGElement !== 'undefined' && element instanceof SVGSVGElement
}

function resolveMermaidControlTarget(
  mermaidElement: Element,
  container: HTMLElement,
): { host: HTMLElement; svg: SVGSVGElement } | null {
  if (isSvgSvgElement(mermaidElement)) {
    const parent = mermaidElement.parentElement
    if (!parent || parent === container) return null
    return { host: parent, svg: mermaidElement }
  }

  if (!(mermaidElement instanceof HTMLElement)) return null
  const svg = mermaidElement.querySelector<SVGSVGElement>('svg')
  if (!svg) return null
  return { host: mermaidElement, svg }
}

function openMermaidOverlay(host: HTMLElement, sourceSvg: SVGSVGElement) {
  activeMermaidOverlay?.close()

  const originalParent = sourceSvg.parentNode
  const originalNextSibling = sourceSvg.nextSibling
  const originalStyleWidth = sourceSvg.style.width
  const originalStyleHeight = sourceSvg.style.height

  const overlay = document.createElement('div')
  overlay.className = 'mermaid-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', t('mermaid.viewerLabel'))

  const toolbar = document.createElement('div')
  toolbar.className = 'mermaid-overlay__toolbar'

  const zoomOutButton = createIconButton('mermaid-overlay__button', t('mermaid.zoomOut'), '-')
  const zoomInButton = createIconButton('mermaid-overlay__button', t('mermaid.zoomIn'), '+')
  const resetButton = createIconButton('mermaid-overlay__button', t('mermaid.reset'), '1:1')
  const closeButton = createIconButton('mermaid-overlay__button', t('mermaid.close'), 'x')
  toolbar.append(zoomOutButton, zoomInButton, resetButton, closeButton)

  const viewport = document.createElement('div')
  viewport.className = 'mermaid-overlay__viewport'

  const canvas = document.createElement('div')
  canvas.className = 'mermaid-overlay__canvas'
  sourceSvg.classList.add('mermaid-overlay__svg')
  canvas.appendChild(sourceSvg)
  viewport.appendChild(canvas)
  overlay.append(toolbar, viewport)
  document.body.appendChild(overlay)
  const baseSvgSize = getSvgDisplaySize(sourceSvg)
  const initialScale = getInitialMermaidOverlayScale(baseSvgSize, viewport)

  let scale = initialScale
  let translateX = 0
  let translateY = 0
  let dragging = false
  let dragStartX = 0
  let dragStartY = 0
  let dragOriginX = 0
  let dragOriginY = 0

  const updateTransform = () => {
    canvas.style.transform = `translate(${formatTransformNumber(translateX)}px, ${formatTransformNumber(
      translateY,
    )}px)`
  }

  const updateSvgSize = () => {
    if (baseSvgSize.width <= 0 || baseSvgSize.height <= 0) return
    sourceSvg.style.width = `${formatTransformNumber(baseSvgSize.width * scale)}px`
    sourceSvg.style.height = `${formatTransformNumber(baseSvgSize.height * scale)}px`
  }

  const updateView = () => {
    updateSvgSize()
    updateTransform()
  }

  const zoomAt = (nextScale: number, clientX?: number, clientY?: number) => {
    const rect = viewport.getBoundingClientRect()
    const pointX = clientX === undefined ? rect.width / 2 : clientX - rect.left
    const pointY = clientY === undefined ? rect.height / 2 : clientY - rect.top
    const originX = rect.width / 2
    const originY = rect.height / 2
    const oldScale = scale
    scale = clamp(nextScale, MERMAID_MIN_SCALE, MERMAID_MAX_SCALE)
    translateX = pointX - originX - ((pointX - originX - translateX) / oldScale) * scale
    translateY = pointY - originY - ((pointY - originY - translateY) / oldScale) * scale
    updateView()
  }

  const resetView = () => {
    scale = initialScale
    translateX = baseSvgSize.width > 0 ? -(baseSvgSize.width * scale) / 2 : 0
    translateY = baseSvgSize.height > 0 ? -(baseSvgSize.height * scale) / 2 : 0
    updateView()
  }

  const close = () => {
    document.removeEventListener('keydown', onKeyDown)
    sourceSvg.classList.remove('mermaid-overlay__svg')
    sourceSvg.style.width = originalStyleWidth
    sourceSvg.style.height = originalStyleHeight
    if (originalParent?.isConnected) {
      const restoreBefore =
        originalNextSibling?.parentNode === originalParent ? originalNextSibling : null
      originalParent.insertBefore(sourceSvg, restoreBefore)
    }
    overlay.remove()
    if (activeMermaidOverlay?.close === close) {
      activeMermaidOverlay = null
    }
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const factor = event.deltaY > 0 ? 0.9 : 1.1
    zoomAt(scale * factor, event.clientX, event.clientY)
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    dragging = true
    dragStartX = event.clientX
    dragStartY = event.clientY
    dragOriginX = translateX
    dragOriginY = translateY
    viewport.setPointerCapture(event.pointerId)
    viewport.classList.add('is-dragging')
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return
    translateX = dragOriginX + event.clientX - dragStartX
    translateY = dragOriginY + event.clientY - dragStartY
    updateTransform()
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) return
    dragging = false
    viewport.classList.remove('is-dragging')
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }

  zoomOutButton.addEventListener('click', () => zoomAt(scale / 1.2))
  zoomInButton.addEventListener('click', () => zoomAt(scale * 1.2))
  resetButton.addEventListener('click', resetView)
  closeButton.addEventListener('click', close)
  viewport.addEventListener('wheel', onWheel, { passive: false })
  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('pointermove', onPointerMove)
  viewport.addEventListener('pointerup', onPointerUp)
  viewport.addEventListener('pointercancel', onPointerUp)
  document.addEventListener('keydown', onKeyDown)
  activeMermaidOverlay = { host, sourceSvg, close }

  resetView()
  closeButton.focus()

  return close
}

export function enhanceMermaidControls(container: HTMLElement): RenderMermaidCleanup {
  const cleanups: Array<() => void> = []

  container.querySelectorAll<Element>('.mermaid').forEach((node) => {
    const target = resolveMermaidControlTarget(node, container)
    if (!target) return
    const { host } = target

    const existing = mermaidControlBindings.get(host)
    if (existing?.button.isConnected) {
      cleanups.push(existing.cleanup)
      return
    }
    existing?.cleanup()

    host.classList.add('mermaid-control-host')
    const button = createIconButton('mermaid-fullscreen-button', t('mermaid.maximize'), '⤢')
    const onClick = () => {
      const latestSvg =
        isSvgSvgElement(node) && node.isConnected ? node : host.querySelector<SVGSVGElement>('svg')
      if (latestSvg) openMermaidOverlay(host, latestSvg)
    }
    button.addEventListener('click', onClick)
    host.appendChild(button)

    const cleanup = () => {
      if (activeMermaidOverlay?.host === host) {
        activeMermaidOverlay.close()
      }
      button.removeEventListener('click', onClick)
      if (button.isConnected) button.remove()
      host.classList.remove('mermaid-control-host')
      if (mermaidControlBindings.get(host)?.button === button) {
        mermaidControlBindings.delete(host)
      }
    }
    mermaidControlBindings.set(host, { button, cleanup })
    cleanups.push(cleanup)
  })

  return () => {
    cleanups.forEach((cleanup) => cleanup())
  }
}

/**
 * 桌面端入口：渲染核心走 `@shared/lib/mermaid-core.js`，此处只注入桌面专属的
 * 全屏控件增强（hover 出按钮 + 滚轮缩放 + 指针拖拽平移）。
 */
export async function renderMermaidIn(container: HTMLElement): Promise<RenderMermaidCleanup> {
  return renderMermaidCore(container, { enhance: enhanceMermaidControls })
}
