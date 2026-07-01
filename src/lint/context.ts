import MarkdownIt from 'markdown-it'
import type { FrontmatterRaw, LintContext, LintKind } from './types.js'

const md = new MarkdownIt('commonmark', { html: false, linkify: false })

export function buildContext(raw: string, kind: LintKind, filePath?: string): LintContext {
  const rawLines = raw.split(/\r?\n/)
  const frontmatter = extractFrontmatter(rawLines)
  const bodyStartLine = frontmatter.present ? frontmatter.endLine + 1 : 0
  const body = rawLines.slice(bodyStartLine).join('\n')
  const tokens = md.parse(body, {})
  // Shift token map lines so they refer to the raw file's 1-based line numbers.
  for (const tok of tokens) {
    if (tok.map) {
      tok.map = [tok.map[0] + bodyStartLine + 1, tok.map[1] + bodyStartLine + 1]
    }
  }
  return {
    raw,
    rawLines,
    kind,
    filePath,
    frontmatter,
    body,
    bodyStartLine,
    tokens,
  }
}

function extractFrontmatter(lines: string[]): FrontmatterRaw {
  const empty: FrontmatterRaw = {
    present: false,
    startLine: -1,
    endLine: -1,
    lines: [],
    data: {},
  }
  if (lines.length === 0) return empty
  if (lines[0] !== '---') return empty
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') {
      end = i
      break
    }
  }
  if (end === -1) return empty
  const fmLines = lines.slice(1, end)
  const data: Record<string, unknown> = {}
  for (const line of fmLines) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]!
    let value: string = m[2] ?? ''
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1)
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1)
    }
    data[key] = value
  }
  return { present: true, startLine: 0, endLine: end, lines: fmLines, data }
}
