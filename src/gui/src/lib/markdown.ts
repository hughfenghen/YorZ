import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import hljs from 'highlight.js/lib/common'

const md = new MarkdownIt({
  // 开启原始 HTML 解析，但仅放行 details/summary 折叠标签（见下方 sanitizeRawHtml），
  // 其余原始 HTML 一律转义为文本，杜绝 script/事件属性等 XSS 面。
  html: true,
  linkify: true,
  breaks: false,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const value = hljs.highlight(str, { language: lang }).value
        return `<pre><code class="hljs language-${lang}">${value}</code></pre>`
      } catch {
        /* fallthrough to default escape */
      }
    }
    return ''
  },
})

// 受控 HTML 白名单：仅允许无属性的 details/summary，以及 <details open>。
const ALLOWED_TAG = /^<\/?(?:details|summary)>$/i
const ALLOWED_DETAILS_OPEN = /^<details\s+open\s*>$/i
// markdown-it-task-lists 通过 html_inline token 注入的禁用复选框（惰性、安全）。
const ALLOWED_TASK_CHECKBOX =
  /^<input class="task-list-item-checkbox"(?: checked="")? disabled="" type="checkbox">$/

function isAllowedTag(tag: string): boolean {
  return ALLOWED_TAG.test(tag) || ALLOWED_DETAILS_OPEN.test(tag) || ALLOWED_TASK_CHECKBOX.test(tag)
}

function sanitizeRawHtml(raw: string): string {
  const escape = md.utils.escapeHtml
  let out = ''
  let last = 0
  const re = /<[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    out += escape(raw.slice(last, m.index))
    const tag = m[0]
    out += isAllowedTag(tag) ? tag : escape(tag)
    last = m.index + tag.length
  }
  out += escape(raw.slice(last))
  return out
}

md.renderer.rules.html_block = (tokens, idx) => sanitizeRawHtml(tokens[idx]!.content)
md.renderer.rules.html_inline = (tokens, idx) => sanitizeRawHtml(tokens[idx]!.content)

export interface RenderOptions {
  /**
   * When both `specId` and `projectId` are set, relative `attachments/...` URLs
   * in image/link tokens are rewritten to
   * `/api/projects/:projectId/specs/:specId/attachments/...` so the server can
   * stream the file. When `projectId` is missing, the original href is kept and
   * a dev-only warning is emitted to surface the missing argument.
   */
  specId?: string
  projectId?: string
  /**
   * How to render a ```mermaid fence.
   *
   * - `'diagram'` (default): emit a `.mermaid` placeholder div for the caller to
   *   paint via `renderMermaidIn(container)` — what SpecDetail does.
   * - `'code'`: render it as an ordinary highlighted code block. Chat streams
   *   markdown into a narrow column, so a half-written mermaid body would be
   *   re-parsed (and fail to draw) on every delta.
   */
  mermaid?: 'diagram' | 'code'
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

let warnedMissingProjectId = false
function warnMissingProjectIdOnce(specId: string): void {
  if (warnedMissingProjectId) return
  warnedMissingProjectId = true
  const isDev =
    typeof import.meta !== 'undefined' &&
    (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true
  if (isDev) {
    console.warn(
      `[markdown] renderMarkdown called with specId="${specId}" but no projectId; ` +
        `relative attachments/* URLs will not be rewritten and may 404.`,
    )
  }
}

function rewriteHrefIfAttachment(
  href: string,
  specId: string,
  projectId: string | undefined,
): string {
  if (!href) return href
  if (/^([a-z]+:)?\/\//i.test(href)) return href
  if (href.startsWith('/')) return href
  if (href.startsWith('#')) return href
  const m = href.match(/^attachments\/(.+)$/)
  if (!m) return href
  if (!projectId) {
    warnMissingProjectIdOnce(specId)
    return href
  }
  return (
    `/api/projects/${encodeURIComponent(projectId)}` +
    `/specs/${encodeURIComponent(specId)}` +
    `/attachments/${encodeURIComponent(m[1]!)}`
  )
}

type RenderEnv = { specId?: string; projectId?: string; mermaid?: 'diagram' | 'code' }

md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const e = env as RenderEnv | undefined
  const specId = e?.specId
  if (specId) {
    const token = tokens[idx]!
    const srcAttr = token.attrs?.find(([k]) => k === 'src')
    if (srcAttr) srcAttr[1] = rewriteHrefIfAttachment(srcAttr[1], specId, e?.projectId)
  }
  return defaultImageRender(tokens, idx, options, env, self)
}

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const e = env as RenderEnv | undefined
  const specId = e?.specId
  if (specId) {
    const token = tokens[idx]!
    const hrefAttr = token.attrs?.find(([k]) => k === 'href')
    if (hrefAttr) {
      const rewritten = rewriteHrefIfAttachment(hrefAttr[1], specId, e?.projectId)
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
  const mode = (env as RenderEnv | undefined)?.mermaid ?? 'diagram'
  if (info === 'mermaid' && mode === 'diagram') {
    const code = token.content
    const escaped = code.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<div class="mermaid" data-mermaid-source="${escaped}">${code}</div>`
  }
  return defaultFenceRender(tokens, idx, options, env, self)
}

md.use(taskLists, { enabled: false, label: false })

export function renderMarkdown(source: string, opts: RenderOptions = {}): string {
  const env: RenderEnv = {}
  if (opts.specId) env.specId = opts.specId
  if (opts.projectId) env.projectId = opts.projectId
  if (opts.mermaid) env.mermaid = opts.mermaid
  return md.render(source, env)
}

/**
 * Remove a leading YAML frontmatter block (`---\n … \n---`) so it isn't rendered
 * into the document body. Mirrors gray-matter's delimiter rules: only strips
 * when the source *starts* with the fence (an optional BOM aside); a document
 * with no closing `---` is returned unchanged, so genuine `---` dividers inside
 * the body are never touched.
 */
export function stripFrontmatter(source: string): string {
  return source.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '')
}
