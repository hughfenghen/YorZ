import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

export interface RenderOptions {
  /**
   * When set, relative `attachments/...` URLs in image/link tokens are rewritten
   * to `/api/specs/:id/attachments/...` so the server can stream the file.
   */
  specId?: string
}

const defaultImageRender =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
const defaultLinkOpenRender =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
const defaultFenceRender =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

function rewriteHrefIfAttachment(href: string, specId: string): string {
  if (!href) return href
  if (/^([a-z]+:)?\/\//i.test(href)) return href
  if (href.startsWith('/')) return href
  if (href.startsWith('#')) return href
  const m = href.match(/^attachments\/(.+)$/)
  if (!m) return href
  return `/api/specs/${encodeURIComponent(specId)}/attachments/${encodeURIComponent(m[1]!)}`
}

md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const specId = (env as { specId?: string } | undefined)?.specId
  if (specId) {
    const token = tokens[idx]!
    const srcAttr = token.attrs?.find(([k]) => k === 'src')
    if (srcAttr) srcAttr[1] = rewriteHrefIfAttachment(srcAttr[1], specId)
  }
  return defaultImageRender(tokens, idx, options, env, self)
}

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const specId = (env as { specId?: string } | undefined)?.specId
  if (specId) {
    const token = tokens[idx]!
    const hrefAttr = token.attrs?.find(([k]) => k === 'href')
    if (hrefAttr) {
      const rewritten = rewriteHrefIfAttachment(hrefAttr[1], specId)
      if (rewritten !== hrefAttr[1]) {
        hrefAttr[1] = rewritten
        // open non-image attachments in a new tab so navigation doesn't lose spec view.
        const targetAttr = token.attrs?.find(([k]) => k === 'target')
        if (targetAttr) targetAttr[1] = '_blank'
        else token.attrs?.push(['target', '_blank'])
        token.attrs?.push(['rel', 'noopener noreferrer'])
      }
    }
  }
  return defaultLinkOpenRender(tokens, idx, options, env, self)
}

md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  const info = token.info.trim()
  if (info === 'mermaid') {
    const code = token.content
    const escaped = code.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<div class="mermaid" data-mermaid-source="${escaped}">${code}</div>`
  }
  return defaultFenceRender(tokens, idx, options, env, self)
}

export function renderMarkdown(source: string, opts: RenderOptions = {}): string {
  return md.render(source, opts.specId ? { specId: opts.specId } : {})
}
