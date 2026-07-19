export interface RenderMermaidCleanup {
  (): void
}

let mermaidLoaded: Promise<typeof import('mermaid')['default']> | null = null

async function loadMermaid() {
  if (!mermaidLoaded) {
    mermaidLoaded = import('mermaid').then((m) => m.default)
  }
  return mermaidLoaded
}

function getTheme(): 'dark' | 'default' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
}

export async function renderMermaidIn(container: HTMLElement): Promise<RenderMermaidCleanup> {
  // Nothing to draw and nothing to re-theme → no-op (and no listener to clean up).
  if (container.querySelector('.mermaid') === null) return () => {}

  const mermaid = await loadMermaid()

  async function render(nodes: HTMLElement[]) {
    if (nodes.length === 0) return
    const theme = getTheme()
    mermaid.initialize({ startOnLoad: false, theme })

    nodes.forEach((node) => {
      const source = node.getAttribute('data-mermaid-source')
      if (source) {
        node.removeAttribute('data-processed')
        // 用 textContent 写入原始源码，避免浏览器把 `<x>` 等标签形 token
        // 当作 HTML 二次解码，保证 mermaid 读到的 textContent 与 lint 一致。
        node.textContent = source
      }
    })

    try {
      await mermaid.run({ nodes })
    } catch (err) {
      console.error('[mermaid] render error:', err)
    }
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
