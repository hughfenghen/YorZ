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
        node.innerHTML = source
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
