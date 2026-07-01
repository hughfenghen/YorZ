import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { lintSpecMd, SPEC_RULES } from './spec-md-lint.js'
import { lintReviewMd, REVIEW_RULES } from './review-md-lint.js'
import type { LintReport } from './types.js'

export * from './types.js'
export { lintSpecMd, SPEC_RULES } from './spec-md-lint.js'
export { lintReviewMd, REVIEW_RULES } from './review-md-lint.js'
export { buildContext } from './context.js'

export interface LintFileOptions {
  skipMermaidParse?: boolean
}

export async function lintFile(path: string, opts: LintFileOptions = {}): Promise<LintReport> {
  const raw = await readFile(path, 'utf8')
  const name = basename(path).toLowerCase()
  if (name === 'review.md') return lintReviewMd(raw, { filePath: path, ...opts })
  return lintSpecMd(raw, { filePath: path, ...opts })
}

export const ALL_RULE_IDS = [...new Set([...SPEC_RULES, ...REVIEW_RULES].map((r) => r.id))]
