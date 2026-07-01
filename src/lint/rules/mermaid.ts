import type { LintContext, LintFinding, LintRule } from '../types.js'

interface MermaidBlock {
  startLine: number
  endLine: number
  code: string
  firstLine: string
}

const DIAGRAM_TYPES = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'xychart-beta',
  'gitGraph',
  'packet-beta',
  'architecture-beta',
  'quadrantChart',
  'requirementDiagram',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'sankey-beta',
  'block-beta',
]

function collectMermaidBlocks(ctx: LintContext): MermaidBlock[] {
  const blocks: MermaidBlock[] = []
  let inMermaid = false
  let start = -1
  let buffer: string[] = []
  for (let i = ctx.bodyStartLine; i < ctx.rawLines.length; i += 1) {
    const raw = ctx.rawLines[i] ?? ''
    const fenceOpen = /^```mermaid\s*$/.exec(raw)
    const fenceClose = /^```\s*$/.exec(raw)
    if (!inMermaid && fenceOpen) {
      inMermaid = true
      start = i + 1
      buffer = []
      continue
    }
    if (inMermaid && fenceClose) {
      const code = buffer.join('\n')
      const firstLine = buffer.find((l) => l.trim().length > 0)?.trim() ?? ''
      blocks.push({ startLine: start + 1, endLine: i + 1, code, firstLine })
      inMermaid = false
      buffer = []
      continue
    }
    if (inMermaid) buffer.push(raw)
  }
  return blocks
}

export const mermaidFence: LintRule = {
  id: 'mermaid/fence',
  description: 'mermaid 代码块首行需匹配已知 diagram type（flowchart / sequenceDiagram / ...）。',
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const blocks = collectMermaidBlocks(ctx)
    for (const b of blocks) {
      if (!b.firstLine) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: 'mermaid 代码块为空。',
          line: b.startLine,
        })
        continue
      }
      const matched = DIAGRAM_TYPES.some(
        (t) => b.firstLine === t || b.firstLine.startsWith(`${t} `) || b.firstLine.startsWith(`${t}\n`),
      )
      if (!matched) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `mermaid 代码块首行 "${b.firstLine}" 不在已知 diagram type 白名单中。`,
          line: b.startLine,
          hint: `已支持：${DIAGRAM_TYPES.slice(0, 8).join(' / ')} ...`,
        })
      }
    }
    return findings
  },
}

let mermaidInitPromise: Promise<typeof import('mermaid')['default'] | null> | null = null

async function initMermaid(): Promise<typeof import('mermaid')['default'] | null> {
  if (mermaidInitPromise) return mermaidInitPromise
  mermaidInitPromise = (async () => {
    try {
      const { JSDOM } = await import('jsdom')
      const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: 'http://localhost/',
        pretendToBeVisual: true,
      })
      const win = dom.window
      const define = (name: string, value: unknown): void => {
        if (name in globalThis) return
        Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
      }
      define('window', win)
      define('document', win.document)
      define('navigator', win.navigator)
      define('HTMLElement', win.HTMLElement)
      define('SVGElement', win.SVGElement)
      define('Element', win.Element)
      define('Node', win.Node)
      define('DocumentFragment', win.DocumentFragment)
      define('getComputedStyle', win.getComputedStyle.bind(win))
      const mermaidMod = await import('mermaid')
      const mermaid = mermaidMod.default
      mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' })
      return mermaid
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.warn(`[lint] mermaid parser unavailable: ${msg}`)
      return null
    }
  })()
  return mermaidInitPromise
}

export const mermaidSyntax: LintRule = {
  id: 'mermaid/syntax',
  description: '调用 mermaid.parse 深校验 diagram 语法（jsdom shim + mermaid@11）。',
  async check(ctx: LintContext): Promise<LintFinding[]> {
    const findings: LintFinding[] = []
    const blocks = collectMermaidBlocks(ctx)
    if (blocks.length === 0) return findings
    const mermaid = await initMermaid()
    if (!mermaid) return findings
    for (const b of blocks) {
      if (!b.firstLine) continue
      try {
        const result = await mermaid.parse(b.code, { suppressErrors: true })
        if (result === false) {
          findings.push({
            ruleId: this.id,
            severity: 'error',
            message: 'mermaid 语法校验失败（parse 返回 false）。',
            line: b.startLine,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `mermaid 语法错误：${msg.split('\n')[0]}`,
          line: b.startLine,
        })
      }
    }
    return findings
  },
}

export const mermaidRules: LintRule[] = [mermaidFence, mermaidSyntax]
