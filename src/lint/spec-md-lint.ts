import { buildContext } from './context.js'
import { annotationsRules } from './rules/annotations.js'
import { appendTasksRules } from './rules/append-tasks.js'
import { frontmatterRules } from './rules/frontmatter.js'
import { headingRules } from './rules/headings.js'
import { mermaidRules } from './rules/mermaid.js'
import { pendingQuestionsRules } from './rules/pending-questions.js'
import { sectionsRules } from './rules/sections.js'
import { taskListRules } from './rules/task-list.js'
import type { LintFinding, LintReport, LintRule } from './types.js'

export interface SpecLintOptions {
  filePath?: string
  skipMermaidParse?: boolean
}

export const SPEC_RULES: LintRule[] = [
  ...frontmatterRules,
  ...headingRules,
  ...sectionsRules,
  ...pendingQuestionsRules,
  ...taskListRules,
  ...appendTasksRules,
  ...mermaidRules,
  ...annotationsRules,
]

export async function lintSpecMd(raw: string, opts: SpecLintOptions = {}): Promise<LintReport> {
  const ctx = buildContext(raw, 'spec', opts.filePath)
  const findings: LintFinding[] = []
  for (const rule of SPEC_RULES) {
    if (opts.skipMermaidParse && rule.id === 'mermaid/syntax') continue
    if (rule.kinds && !rule.kinds.includes('spec')) continue
    const result = await rule.check(ctx)
    findings.push(...result)
  }
  findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
  return {
    filePath: opts.filePath,
    kind: 'spec',
    findings,
    errorCount: findings.filter((f) => f.severity === 'error').length,
    warnCount: findings.filter((f) => f.severity === 'warn').length,
  }
}
