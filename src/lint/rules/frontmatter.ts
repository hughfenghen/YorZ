import type { LintContext, LintFinding, LintRule } from '../types.js'

const REQUIRED = ['stage', 'last_action', 'updated_at', 'summary'] as const
const STAGES = new Set(['plan', 'tasks', 'execute', 'done'])

export const frontmatterRequiredFields: LintRule = {
  id: 'frontmatter/required-fields',
  description:
    'frontmatter 必须存在，且 stage/last_action/updated_at/summary 齐全、顺序固定，无额外字段。',
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const fm = ctx.frontmatter
    if (!fm.present) {
      findings.push({
        ruleId: this.id,
        severity: 'error',
        message: '缺少 YAML frontmatter（首行应为 --- 且四字段齐全）。',
        line: 1,
      })
      return findings
    }
    // Collect keys in order from the raw lines.
    const keys: string[] = []
    for (const line of fm.lines) {
      const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(line)
      if (m) keys.push(m[1]!)
    }
    // Missing / extra
    for (const req of REQUIRED) {
      if (!keys.includes(req)) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `frontmatter 缺少字段：${req}`,
          line: fm.startLine + 1,
        })
      }
    }
    for (const k of keys) {
      if (!(REQUIRED as readonly string[]).includes(k)) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `frontmatter 出现未知字段：${k}`,
          line: fm.startLine + 1,
        })
      }
    }
    // Order (only check when all four are present)
    if (REQUIRED.every((r) => keys.includes(r))) {
      for (let i = 0; i < REQUIRED.length; i += 1) {
        if (keys[i] !== REQUIRED[i]) {
          findings.push({
            ruleId: this.id,
            severity: 'error',
            message: `frontmatter 字段顺序应为 ${REQUIRED.join(' → ')}，当前为 ${keys.join(' → ')}`,
            line: fm.startLine + 1,
          })
          break
        }
      }
    }
    // Validate stage value.
    const stage = fm.data.stage
    if (typeof stage === 'string' && !STAGES.has(stage)) {
      findings.push({
        ruleId: this.id,
        severity: 'error',
        message: `frontmatter.stage 必须是 plan | tasks | execute | done，当前为 ${stage}`,
        line: fm.startLine + 1,
      })
    }
    return findings
  },
}

export const frontmatterUpdatedAt: LintRule = {
  id: 'frontmatter/updated-at',
  description: 'updated_at 值应形如 YYYY-MM-DD HH:mm:ss，原文中带单引号。',
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const fm = ctx.frontmatter
    if (!fm.present) return findings
    const rawLine = fm.lines.find((l) => l.startsWith('updated_at'))
    if (!rawLine) return findings
    const value = String(fm.data.updated_at ?? '')
    const lineNo = fm.startLine + 1 + fm.lines.indexOf(rawLine) + 1
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
      findings.push({
        ruleId: this.id,
        severity: 'error',
        message: `updated_at 必须为 YYYY-MM-DD HH:mm:ss 秒级时间戳，当前为 "${value}"`,
        line: lineNo,
      })
    }
    // Must be single-quoted in the raw line.
    const afterColon = rawLine.slice(rawLine.indexOf(':') + 1).trim()
    if (!(afterColon.startsWith("'") && afterColon.endsWith("'"))) {
      findings.push({
        ruleId: this.id,
        severity: 'error',
        message: 'updated_at 写入时必须使用单引号包裹，避免 YAML 1.1 时间戳解析。',
        line: lineNo,
        hint: `updated_at: '${value}'`,
      })
    }
    return findings
  },
}

export const frontmatterSummaryLength: LintRule = {
  id: 'frontmatter/summary-length',
  description: 'summary 非空、长度 ≤ 200。',
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const fm = ctx.frontmatter
    if (!fm.present) return findings
    const value = String(fm.data.summary ?? '')
    const lineNo = fm.startLine + 1 + fm.lines.findIndex((l) => l.startsWith('summary')) + 1
    if (!value.trim()) {
      findings.push({
        ruleId: this.id,
        severity: 'warn',
        message: 'summary 不应为空。',
        line: lineNo,
      })
    } else if (value.length > 200) {
      findings.push({
        ruleId: this.id,
        severity: 'warn',
        message: `summary 长度 ${value.length} 超过 200 字符。`,
        line: lineNo,
      })
    }
    return findings
  },
}

export const frontmatterRules: LintRule[] = [
  frontmatterRequiredFields,
  frontmatterUpdatedAt,
  frontmatterSummaryLength,
]
