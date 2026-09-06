/**
 * Unified-diff row model shared by the desktop `DiffView` and the mobile Git
 * page.
 *
 * `parse-diff` only splits a patch into hunks; turning a hunk change into the
 * row we actually paint (old/new line numbers, the leading marker glyph split
 * off the code, the add/del tone) used to live inline in the desktop JSX. Both
 * shells need the exact same arithmetic, and it is the part that is easy to get
 * subtly wrong, so it lives here as pure functions — the layer unit tests cover.
 *
 * Only the row model and the highlighting are shared; the markup is not. The
 * two shells paint very different layouts (12ch line gutters vs. 9ch, close
 * button vs. none) and page-level UI is explicitly out of the shared scope.
 */

import parseDiff from 'parse-diff'
import hljs from 'highlight.js/lib/common'

/*
 * File extension → highlight.js language. `highlight.js/lib/common` (the bundle
 * the markdown renderer already pulls in) only ships the common grammars, so
 * every hit is re-checked with getLanguage() and unknown types fall back to
 * plain text instead of throwing.
 */
const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  vue: 'xml',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
}

export type DiffRowTone = 'add' | 'del' | 'normal'

export interface DiffRow {
  /** Line number on the old side; empty string on an added line. */
  oldLn: number | string
  /** Line number on the new side; empty string on a deleted line. */
  newLn: number | string
  /** git's leading `+`/`-`/space glyph, split off the code. */
  marker: string
  /** The line content with the marker removed. */
  code: string
  tone: DiffRowTone
}

export interface DiffChunkRows {
  /** The `@@ ... @@` hunk header, verbatim. */
  header: string
  rows: DiffRow[]
}

export interface DiffFileRows {
  chunks: DiffChunkRows[]
}

/** Resolve a highlight.js language for a path, or undefined for plain text. */
export function diffLanguage(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const name = EXT_LANGUAGE[ext]
  return name && hljs.getLanguage(name) ? name : undefined
}

/**
 * Highlight one diff line, returning hljs HTML — or undefined when there is no
 * language, no code, or hljs throws.
 *
 * Highlighted per line, not per hunk: a diff line is the unit we render, and
 * splitting hljs' nested markup back apart at newlines would mean re-opening
 * spans by hand. The cost is that constructs spanning several lines (block
 * comments, multi-line template literals) are highlighted line-locally.
 */
export function highlightLine(code: string, lang?: string): string | undefined {
  if (!lang || !code) return undefined
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
  } catch {
    return undefined
  }
}

/** Parse a unified patch into the per-file / per-hunk rows both shells paint. */
export function parsePatchRows(patch: string): DiffFileRows[] {
  if (!patch) return []
  return parseDiff(patch).map((file) => ({
    chunks: file.chunks.map((chunk) => ({
      header: chunk.content,
      rows: chunk.changes.map(toRow),
    })),
  }))
}

type ParsedChange = ReturnType<typeof parseDiff>[number]['chunks'][number]['changes'][number]

function toRow(change: ParsedChange): DiffRow {
  const oldLn =
    change.type === 'add' ? '' : change.type === 'del' ? change.ln : (change as { ln1: number }).ln1
  const newLn =
    change.type === 'del' ? '' : change.type === 'add' ? change.ln : (change as { ln2: number }).ln2
  return {
    oldLn,
    newLn,
    // parse-diff keeps git's leading +/-/space marker on the content; it is not
    // code, so it is split off before highlighting.
    marker: change.content.slice(0, 1),
    code: change.content.slice(1),
    tone: change.type === 'add' ? 'add' : change.type === 'del' ? 'del' : 'normal',
  }
}
