import { t } from '../i18n/index.js'

export interface RenderMermaidCleanup {
  (): void
}

let mermaidLoaded: Promise<(typeof import('mermaid'))['default']> | null = null
let mermaidRunQueue: Promise<void> = Promise.resolve()
const containerEpoch = new WeakMap<HTMLElement, number>()

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

async function loadMermaid() {
  if (!mermaidLoaded) {
    mermaidLoaded = import('mermaid').then((m) => m.default)
  }
  return mermaidLoaded
}

function getTheme(): 'dark' | 'default' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve())
      return
    }
    window.setTimeout(resolve, 0)
  })
}

function startContainerRender(container: HTMLElement): number {
  const epoch = (containerEpoch.get(container) ?? 0) + 1
  containerEpoch.set(container, epoch)
  return epoch
}

function isCurrentContainerRender(container: HTMLElement, epoch: number): boolean {
  return containerEpoch.get(container) === epoch
}

async function enqueueMermaidRun(task: () => Promise<void>): Promise<void> {
  const run = mermaidRunQueue.then(task, task)
  mermaidRunQueue = run.catch(() => {})
  await run
}

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

  let scale = 1
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
    )}px) scale(${formatTransformNumber(scale)})`
  }

  const zoomAt = (nextScale: number, clientX?: number, clientY?: number) => {
    const rect = viewport.getBoundingClientRect()
    const pointX = clientX === undefined ? rect.width / 2 : clientX - rect.left
    const pointY = clientY === undefined ? rect.height / 2 : clientY - rect.top
    const originX = rect.width / 2
    const originY = rect.height / 2
    const oldScale = scale
    scale = clamp(nextScale, 0.2, 8)
    translateX = pointX - originX - ((pointX - originX - translateX) / oldScale) * scale
    translateY = pointY - originY - ((pointY - originY - translateY) / oldScale) * scale
    updateTransform()
  }

  const resetView = () => {
    const { width, height } = getSvgDisplaySize(sourceSvg)
    scale = 1
    translateX = width > 0 ? -width / 2 : 0
    translateY = height > 0 ? -height / 2 : 0
    updateTransform()
  }

  const close = () => {
    document.removeEventListener('keydown', onKeyDown)
    sourceSvg.classList.remove('mermaid-overlay__svg')
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

export async function renderMermaidIn(container: HTMLElement): Promise<RenderMermaidCleanup> {
  // Nothing to draw and nothing to re-theme → no-op (and no listener to clean up).
  if (container.querySelector('.mermaid') === null) return () => {}

  const epoch = startContainerRender(container)
  const mermaid = await loadMermaid()
  if (!isCurrentContainerRender(container, epoch)) return () => {}
  // On client-side route transitions Solid may assign the ref before the article
  // is fully connected/paintable. Mermaid expects live browser nodes, so yield one
  // frame and let a newer render supersede this one if the resource updates again.
  await nextFrame()
  if (!isCurrentContainerRender(container, epoch)) return () => {}
  let controlsCleanup: RenderMermaidCleanup = () => {}

  function refreshControls() {
    controlsCleanup()
    controlsCleanup = enhanceMermaidControls(container)
  }

  async function render(nodes: HTMLElement[]) {
    const liveNodes = nodes.filter((node) => node.isConnected && container.contains(node))
    if (liveNodes.length === 0) return

    await enqueueMermaidRun(async () => {
      if (!isCurrentContainerRender(container, epoch)) return
      const currentNodes = liveNodes.filter((node) => node.isConnected && container.contains(node))
      if (currentNodes.length === 0) return

      const theme = getTheme()
      mermaid.initialize({ startOnLoad: false, theme })
      controlsCleanup()
      controlsCleanup = () => {}

      currentNodes.forEach((node) => {
        const source = node.getAttribute('data-mermaid-source')
        if (source) {
          node.removeAttribute('data-processed')
          // 用 textContent 写入原始源码，避免浏览器把 `<x>` 等标签形 token
          // 当作 HTML 二次解码，保证 mermaid 读到的 textContent 与 lint 一致。
          node.textContent = source
        }
      })

      try {
        await mermaid.run({ nodes: currentNodes })
        await nextFrame()
        refreshControls()
      } catch (err) {
        console.error('[mermaid] render error:', err)
      }
    })
  }

  // Initial pass only renders NEW/CHANGED nodes: morphdom leaves unchanged mermaid
  // SVGs in place (still carrying data-processed), so rendering all of them again
  // would needlessly redraw and thrash height. Only raw placeholders — those
  // without data-processed — need painting.
  const pending = Array.from(
    container.querySelectorAll<HTMLElement>('.mermaid:not([data-processed])'),
  )
  // Await the actual render: the returned promise must not resolve until the SVG
  // has been injected, so callers observing the final height see it settled.
  await render(pending)
  await nextFrame()
  refreshControls()

  // A theme flip must re-render EVERY diagram, processed or not — re-query live at
  // event time so diagrams added by later refreshes are included too.
  const rerenderAll = () =>
    void render(Array.from(container.querySelectorAll<HTMLElement>('.mermaid')))
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', rerenderAll)

  return () => {
    controlsCleanup()
    mediaQuery.removeEventListener('change', rerenderAll)
  }
}
