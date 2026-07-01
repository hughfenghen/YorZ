import type { LintContext, LintFinding, LintRule } from '../types.js'

/** Returns true when the `！！！` occurrence is inside inline code (`…`) on the same line. */
function isInsideInlineCode(line: string, idx: number): boolean {
  let ticks = 0
  for (let i = 0; i < idx; i += 1) if (line[i] === '`') ticks += 1
  return ticks % 2 === 1
}

export const annotationsLeftover: LintRule = {
  id: 'annotations/leftover',
  description: '正文中残留 `！！！` 批注 → tasks 阶段应消费后删除。',
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    let inFence = false
    for (let i = ctx.bodyStartLine; i < ctx.rawLines.length; i += 1) {
      const raw = ctx.rawLines[i] ?? ''
      if (/^```/.test(raw)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      const idx = raw.indexOf('！！！')
      if (idx === -1) continue
      if (isInsideInlineCode(raw, idx)) continue
      findings.push({
        ruleId: this.id,
        severity: 'warn',
        message: '正文残留 `！！！` 批注，请在 tasks 阶段消费后删除。',
        line: i + 1,
      })
    }
    return findings
  },
}

export const annotationsRules: LintRule[] = [annotationsLeftover]
