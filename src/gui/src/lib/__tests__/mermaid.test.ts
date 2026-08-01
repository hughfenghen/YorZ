import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  run: vi.fn<(args: { nodes: HTMLElement[] }) => Promise<void>>(),
}))

vi.mock('mermaid', () => ({
  default: mermaidMock,
}))

let dom: JSDOM

function installDom() {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true })
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: dom.window.HTMLElement,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'Element', { value: dom.window.Element, configurable: true })
  Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, configurable: true })
  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    configurable: true,
  })
  Object.defineProperty(dom.window, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => {
      dom.window.setTimeout(() => cb(0), 0)
      return 1
    },
    configurable: true,
  })
}

function mermaidNode(source = 'flowchart TD\n  A --> B'): HTMLElement {
  const node = document.createElement('div')
  node.className = 'mermaid'
  node.setAttribute('data-mermaid-source', source)
  node.textContent = source
  return node
}

describe('renderMermaidIn', () => {
  beforeEach(() => {
    installDom()
    mermaidMock.initialize.mockClear()
    mermaidMock.run.mockReset()
    mermaidMock.run.mockResolvedValue(undefined)
  })

  afterEach(() => {
    dom.window.close()
    vi.resetModules()
  })

  it('同一容器连续触发渲染时只让最新批次调用 mermaid.run', async () => {
    const article = document.createElement('article')
    article.appendChild(mermaidNode())
    document.body.appendChild(article)
    const { renderMermaidIn } = await import('../mermaid.js')

    const first = renderMermaidIn(article)
    const second = renderMermaidIn(article)

    await Promise.all([first, second])

    expect(mermaidMock.run).toHaveBeenCalledTimes(1)
    expect(mermaidMock.run.mock.calls[0]![0].nodes).toHaveLength(1)
  })

  it('跳过已经脱离 DOM 的 mermaid 节点', async () => {
    const article = document.createElement('article')
    article.appendChild(mermaidNode())
    const { renderMermaidIn } = await import('../mermaid.js')

    await renderMermaidIn(article)

    expect(mermaidMock.run).not.toHaveBeenCalled()
  })

  it('渲染后挂载最大化入口且保留 mermaid 关键 data 属性', async () => {
    mermaidMock.run.mockImplementation(async ({ nodes }) => {
      nodes.forEach((node) => {
        node.setAttribute('data-processed', 'true')
        node.innerHTML = '<svg viewBox="0 0 100 80"><g><text>diagram</text></g></svg>'
      })
    })
    const source = 'flowchart TD\n  A --> B'
    const article = document.createElement('article')
    const node = mermaidNode(source)
    article.appendChild(node)
    document.body.appendChild(article)
    const { renderMermaidIn } = await import('../mermaid.js')

    const cleanup = await renderMermaidIn(article)

    expect(node.getAttribute('data-mermaid-source')).toBe(source)
    expect(node.getAttribute('data-processed')).toBe('true')
    expect(node.querySelectorAll('.mermaid-fullscreen-button')).toHaveLength(1)

    cleanup()

    expect(node.querySelector('.mermaid-fullscreen-button')).toBeNull()
  })

  it('重复增强不会为同一个 mermaid 节点追加多个入口', async () => {
    const article = document.createElement('article')
    const node = mermaidNode()
    node.innerHTML = '<svg viewBox="0 0 100 80"></svg>'
    article.appendChild(node)
    document.body.appendChild(article)
    const { enhanceMermaidControls } = await import('../mermaid.js')

    const firstCleanup = enhanceMermaidControls(article)
    const secondCleanup = enhanceMermaidControls(article)

    expect(node.querySelectorAll('.mermaid-fullscreen-button')).toHaveLength(1)

    secondCleanup()
    firstCleanup()
  })

  it('点击最大化入口后打开 overlay，按钮缩放与 Esc 关闭可用', async () => {
    mermaidMock.run.mockImplementation(async ({ nodes }) => {
      nodes.forEach((node) => {
        node.innerHTML = '<svg viewBox="0 0 100 80"><g><text>diagram</text></g></svg>'
      })
    })
    const article = document.createElement('article')
    const node = mermaidNode()
    article.appendChild(node)
    document.body.appendChild(article)
    const { renderMermaidIn } = await import('../mermaid.js')

    const cleanup = await renderMermaidIn(article)
    const originalSvg = node.querySelector('svg')
    const openButton = article.querySelector<HTMLButtonElement>('.mermaid-fullscreen-button')
    openButton?.click()

    const overlay = document.querySelector<HTMLElement>('.mermaid-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay?.querySelectorAll('svg')).toHaveLength(1)
    expect(overlay?.querySelector('svg')).toBe(originalSvg)
    expect(node.querySelector('svg')).toBeNull()

    const canvas = overlay!.querySelector<HTMLElement>('.mermaid-overlay__canvas')!
    expect(canvas.style.transform).toBe('translate(-50px, -40px) scale(1)')
    const zoomIn = overlay!.querySelectorAll<HTMLButtonElement>('.mermaid-overlay__button')[1]!
    zoomIn.click()
    expect(canvas.style.transform).toContain('scale(1.2)')

    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('.mermaid-overlay')).toBeNull()
    expect(node.querySelector('svg')).toBe(originalSvg)

    cleanup()
  })

  it('滚轮缩放以鼠标位置为中心更新平移量', async () => {
    const article = document.createElement('article')
    const node = mermaidNode()
    node.innerHTML = '<svg viewBox="0 0 100 80"></svg>'
    article.appendChild(node)
    document.body.appendChild(article)
    const { enhanceMermaidControls } = await import('../mermaid.js')

    const cleanup = enhanceMermaidControls(article)
    node.querySelector<HTMLButtonElement>('.mermaid-fullscreen-button')?.click()

    const viewport = document.querySelector<HTMLElement>('.mermaid-overlay__viewport')!
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 100,
      bottom: 100,
      left: 0,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    })
    viewport.dispatchEvent(
      new dom.window.WheelEvent('wheel', {
        deltaY: -1,
        clientX: 75,
        clientY: 25,
        cancelable: true,
      }),
    )

    const canvas = document.querySelector<HTMLElement>('.mermaid-overlay__canvas')!
    expect(canvas.style.transform).toBe('translate(-57.5px, -41.5px) scale(1.1)')

    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
    cleanup()
  })
})
