export interface RenderMermaidCleanup {
  (): void
}

let mermaidLoaded: Promise<typeof import('mermaid')['default']> | null = null
let mermaidRunQueue: Promise<void> = Promise.resolve()
const containerEpoch = new WeakMap<HTMLElement, number>()

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

  async function render(nodes: HTMLElement[]) {
    const liveNodes = nodes.filter((node) => node.isConnected && container.contains(node))
    if (liveNodes.length === 0) return

    await enqueueMermaidRun(async () => {
      if (!isCurrentContainerRender(container, epoch)) return
      const currentNodes = liveNodes.filter((node) => node.isConnected && container.contains(node))
      if (currentNodes.length === 0) return

      const theme = getTheme()
      mermaid.initialize({ startOnLoad: false, theme })

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

  // A theme flip must re-render EVERY diagram, processed or not — re-query live at
  // event time so diagrams added by later refreshes are included too.
  const rerenderAll = () =>
    void render(Array.from(container.querySelectorAll<HTMLElement>('.mermaid')))
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', rerenderAll)

  return () => {
    mediaQuery.removeEventListener('change', rerenderAll)
  }
}
