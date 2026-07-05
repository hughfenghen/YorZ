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
  const nodes = container.querySelectorAll<HTMLElement>('.mermaid')
  if (nodes.length === 0) return () => {}

  const mermaid = await loadMermaid()

  async function render() {
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
      await mermaid.run({ nodes: Array.from(nodes) })
    } catch (err) {
      console.error('[mermaid] render error:', err)
    }
  }

  void render()

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', render)

  return () => {
    mediaQuery.removeEventListener('change', render)
  }
}
