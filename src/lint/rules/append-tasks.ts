import type { LintContext, LintFinding, LintRule } from '../types.js'
import { collectHeadings, stripHeadingNumber } from './headings.js'

function findSection(ctx: LintContext, name: string) {
  const headings = collectHeadings(ctx)
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i]!
    if (h.level !== 2) continue
    const bare = stripHeadingNumber(h.text)
    if (bare !== name) continue
    const next = headings.slice(i + 1).find((x) => x.level === 2)
    return { start: h.line, end: next ? next.line - 1 : ctx.rawLines.length }
  }
  return null
}

const APPEND_RE = /^-\s*\[(open|fixed)\]\s+\[(feat|refct|fix)\]\s+.+$/

export const appendTaskFormat: LintRule = {
  id: 'append-task/format',
  description: '`## 追加任务` 下条目格式 `- [open|fixed] [feat|refct|fix] ...`；空态允许 `- 暂无`。',
  kinds: ['spec'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const section = findSection(ctx, '追加任务')
    if (!section) return findings
    for (let ln = section.start; ln < section.end; ln += 1) {
      const raw = ctx.rawLines[ln] ?? ''
      if (/^#{1,6}\s/.test(raw)) continue
      // Skip blank lines and continuation lines (indented body of a list item).
      if (raw.trim() === '') continue
      if (/^\s+/.test(raw)) continue
      // Only top-level list items are subject to format check.
      const m = /^-\s+(.*)$/.exec(raw)
      if (!m) continue
      const rest = m[1]!
      if (rest.trim() === '暂无') continue
      if (!APPEND_RE.test(raw)) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: '追加任务条目必须匹配 `- [open|fixed] [feat|refct|fix] <描述>`。',
          line: ln + 1,
        })
      }
    }
    return findings
  },
}

export const appendTasksRules: LintRule[] = [appendTaskFormat]
