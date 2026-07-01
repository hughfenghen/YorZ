import type { LintContext, LintFinding, LintRule } from '../types.js'
import { collectHeadings, stripHeadingNumber } from './headings.js'

const ENTRY_HEADING_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

const REQUIRED_SUBSECTIONS = ['变更总结', '影响范围', '风险提醒', '变更文件清单']

export const reviewEntryHeading: LintRule = {
  id: 'review/entry-heading',
  description: '每条 review 二级标题为 `## YYYY-MM-DD HH:mm:ss` 且降序排列。',
  kinds: ['review'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const h2s = collectHeadings(ctx).filter((h) => h.level === 2)
    let previous = ''
    for (const h of h2s) {
      if (!ENTRY_HEADING_RE.test(h.text)) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `review 二级标题应为 "## YYYY-MM-DD HH:mm:ss"，当前为 "${h.text}"。`,
          line: h.line,
        })
        continue
      }
      if (previous && h.text > previous) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `review 条目应按时间降序排列，"${h.text}" 在 "${previous}" 之后。`,
          line: h.line,
        })
      }
      previous = h.text
    }
    return findings
  },
}

export const reviewEntrySections: LintRule = {
  id: 'review/entry-sections',
  description: '每条 review 恰含 4 个三级小节：变更总结 / 影响范围 / 风险提醒 / 变更文件清单，顺序固定。',
  kinds: ['review'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const headings = collectHeadings(ctx)
    for (let i = 0; i < headings.length; i += 1) {
      const h = headings[i]!
      if (h.level !== 2) continue
      if (!ENTRY_HEADING_RE.test(h.text)) continue
      const next = headings.slice(i + 1).find((x) => x.level === 2)
      const subs = headings
        .slice(i + 1)
        .filter((x) => x.level === 3 && (!next || x.line < next.line))
      const names = subs.map((s) => stripHeadingNumber(s.text))
      for (let j = 0; j < REQUIRED_SUBSECTIONS.length; j += 1) {
        const req = REQUIRED_SUBSECTIONS[j]!
        if (names[j] !== req) {
          findings.push({
            ruleId: this.id,
            severity: 'error',
            message: `review 条目 "${h.text}" 缺少或错序的三级小节 "${req}"（应位于第 ${j + 1} 位）。`,
            line: h.line,
          })
          break
        }
      }
      if (names.length !== REQUIRED_SUBSECTIONS.length) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `review 条目 "${h.text}" 三级小节数量应为 4，实为 ${names.length}。`,
          line: h.line,
        })
      }
    }
    return findings
  },
}

export const reviewSectionsRules: LintRule[] = [reviewEntryHeading, reviewEntrySections]
