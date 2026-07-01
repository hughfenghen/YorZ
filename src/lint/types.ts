import type Token from 'markdown-it/lib/token.mjs'

export type LintSeverity = 'error' | 'warn'

export type LintKind = 'spec' | 'review'

export interface LintFinding {
  ruleId: string
  severity: LintSeverity
  message: string
  line?: number
  hint?: string
}

export interface FrontmatterRaw {
  present: boolean
  startLine: number
  endLine: number
  lines: string[]
  data: Record<string, unknown>
}

export interface LintContext {
  raw: string
  rawLines: string[]
  kind: LintKind
  filePath?: string
  frontmatter: FrontmatterRaw
  body: string
  bodyStartLine: number
  tokens: Token[]
}

export interface LintRule {
  id: string
  description: string
  kinds?: LintKind[]
  check(ctx: LintContext): LintFinding[] | Promise<LintFinding[]>
}

export interface LintReport {
  filePath?: string
  kind: LintKind
  findings: LintFinding[]
  errorCount: number
  warnCount: number
}
