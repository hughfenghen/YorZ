import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

export function renderMarkdown(source: string): string {
  return md.render(source)
}
