import { buildContext } from './context.js'
import { mermaidRules } from './rules/mermaid.js'
import { reviewSectionsRules } from './rules/review-sections.js'
import type { LintFinding, LintReport, LintRule } from './types.js'

export interface ReviewLintOptions {
  filePath?: string
  skipMermaidParse?: boolean
}

export const REVIEW_RULES: LintRule[] = [...reviewSectionsRules, ...mermaidRules]

export async function lintReviewMd(raw: string, opts: ReviewLintOptions = {}): Promise<LintReport> {
  const ctx = buildContext(raw, 'review', opts.filePath)
  const findings: LintFinding[] = []
  for (const rule of REVIEW_RULES) {
    if (opts.skipMermaidParse && rule.id === 'mermaid/syntax') continue
    if (rule.kinds && !rule.kinds.includes('review')) continue
    const result = await rule.check(ctx)
    findings.push(...result)
  }
  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
  return {
    filePath: opts.filePath,
    kind: 'review',
    findings,
    errorCount: findings.filter((f) => f.severity === 'error').length,
    warnCount: findings.filter((f) => f.severity === 'warn').length,
  }
}
