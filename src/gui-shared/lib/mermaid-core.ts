import { resolvedTheme } from './theme.js'

export interface RenderMermaidCleanup {
  (): void
}

/**
 * Platform hooks for the render core.
 *
 * The core owns everything that is genuinely platform-independent: lazy-loading
 * mermaid, the per-container epoch guard, the serial run queue, painting only
 * unprocessed placeholders, and the full redraw on a theme flip. What it does
 * NOT own is the *interaction* layered on top of a finished diagram — desktop
 * adds a hover fullscreen button driven by wheel-zoom/pointer-drag, mobile opens
 * a pinch-zoom sheet. Those have no common shape, so each side injects its own
 * `enhance` and the core just calls it at the right moments.
 */
export interface MermaidCoreOptions {
  /**
   * Called after every successful paint (and after each theme redraw), once the
   * SVGs are in the DOM. Must return a cleanup that undoes whatever it attached;
   * the core calls it before re-rendering and on teardown.
   */
  enhance?: (container: HTMLElement) => RenderMermaidCleanup
}

let mermaidLoaded: Promise<(typeof import('mermaid'))['default']> | null = null
let mermaidRunQueue: Promise<void> = Promise.resolve()
const containerEpoch = new WeakMap<HTMLElement, number>()

async function loadMermaid() {
  if (!mermaidLoaded) {
    mermaidLoaded = import('mermaid').then((m) => m.default)
  }
  return mermaidLoaded
}

function getTheme(): 'dark' | 'default' {
  // 跟随应用主题（含手动选择的 light/dark），而非系统偏好——否则在亮色系统上
  // 手动切到暗色时，图表仍会渲染成亮色。
  return resolvedTheme() === 'dark' ? 'dark' : 'default'
}

export function nextFrame(): Promise<void> {
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

export async function renderMermaidCore(
  container: HTMLElement,
  opts: MermaidCoreOptions = {},
): Promise<RenderMermaidCleanup> {
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
  let enhanceCleanup: RenderMermaidCleanup = () => {}

  function refreshEnhance() {
    enhanceCleanup()
    enhanceCleanup = opts.enhance ? opts.enhance(container) : () => {}
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
      enhanceCleanup()
      enhanceCleanup = () => {}

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
        refreshEnhance()
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
  refreshEnhance()

  // A theme flip must re-render EVERY diagram, processed or not — re-query live at
  // event time so diagrams added by later refreshes are included too.
  const rerenderAll = () =>
    void render(Array.from(container.querySelectorAll<HTMLElement>('.mermaid')))
  // 观察 <html data-kb-theme> 而非 matchMedia：属性是所有主题变更路径（引导脚本、
  // 手动切换、system 模式下的系统翻转）的共同终点，一处订阅即可覆盖全部。
  // 与本模块其余浏览器 API 一致地走 window.*，而非裸全局
  const themeObserver = new window.MutationObserver(rerenderAll)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-kb-theme'],
  })

  return () => {
    enhanceCleanup()
    themeObserver.disconnect()
  }
}
