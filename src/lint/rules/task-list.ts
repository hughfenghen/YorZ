import type { LintContext, LintFinding, LintRule } from '../types.js'
import { collectHeadings, stripHeadingNumber } from './headings.js'

function findSectionRange(ctx: LintContext, sectionName: string): { start: number; end: number } | null {
  const headings = collectHeadings(ctx)
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i]!
    if (h.level !== 2) continue
    const bare = stripHeadingNumber(h.text)
    if (bare !== sectionName) continue
    const next = headings.slice(i + 1).find((x) => x.level === 2)
    return { start: h.line, end: next ? next.line - 1 : ctx.rawLines.length }
  }
  return null
}

export const taskListFormat: LintRule = {
  id: 'task-list/format',
  description: '`## 任务清单` 下仅允许单层 `- [ ]` / `- [x]`，不允许嵌套或其它状态符号。',
  kinds: ['spec'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const range = findSectionRange(ctx, '任务清单')
    if (!range) return findings
    for (let ln = range.start; ln < range.end; ln += 1) {
      const raw = ctx.rawLines[ln] ?? ''
      // Skip heading + blank lines
      if (/^#{1,6}\s/.test(raw)) continue
      // Nested list-item (indented `- `) — disallowed inside task list.
      if (/^\s+-\s/.test(raw)) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: '任务清单禁止嵌套子项，只允许单层 `- [ ] / - [x]`。',
          line: ln + 1,
        })
        continue
      }
      const m = /^-\s+\[(.)\]\s*(.*)$/.exec(raw)
      if (!m) {
        if (/^-\s+/.test(raw)) {
          findings.push({
            ruleId: this.id,
            severity: 'error',
            message: '任务清单条目必须以 `- [ ]` 或 `- [x]` 开头。',
            line: ln + 1,
          })
        }
        continue
      }
      const flag = m[1]!
      if (flag !== ' ' && flag !== 'x') {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `任务清单条目只允许 [ ] 或 [x]，当前为 [${flag}]。`,
          line: ln + 1,
        })
      }
    }
    return findings
  },
}

export const taskListRules: LintRule[] = [taskListFormat]
