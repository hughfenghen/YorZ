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
})
