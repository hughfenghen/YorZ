import type { LintContext, LintFinding, LintRule } from '../types.js'
import { collectHeadings, stripHeadingNumber } from './headings.js'

const REQUIRED_ORDER = [
  '背景',
  '需求',
  '现状分析',
  '技术实现方案',
  '待确认问题',
  '任务清单',
  '执行记录',
]

const CORE_ORDER = [
  '现状分析',
  '技术实现方案',
  '待确认问题',
  '任务清单',
  '追加任务',
  '执行记录',
]

export const sectionsRequired: LintRule = {
  id: 'sections/required',
  description: '七大必备章节齐全（背景 / 需求 / 现状分析 / 技术实现方案 / 待确认问题 / 任务清单 / 执行记录），核心章节按指定顺序；追加任务由用户额外操作产生，属可选章节，若存在须落在任务清单与执行记录之间。',
  kinds: ['spec'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const h2s = collectHeadings(ctx)
      .filter((h) => h.level === 2)
      .map((h) => ({ ...h, bare: stripHeadingNumber(h.text) }))
    const names = h2s.map((h) => h.bare)
    for (const req of REQUIRED_ORDER) {
      if (!names.includes(req)) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `缺少必备章节 "## ${req}"。`,
          line: ctx.bodyStartLine + 1,
        })
      }
    }
    // Order check on the CORE six.
    const coreLines: { name: string; line: number }[] = []
    for (const h of h2s) {
      if (CORE_ORDER.includes(h.bare)) coreLines.push({ name: h.bare, line: h.line })
    }
    let expectIdx = 0
    for (const found of coreLines) {
      const idx = CORE_ORDER.indexOf(found.name)
      if (idx < expectIdx) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `章节 "${found.name}" 位置不符：核心章节应按 ${CORE_ORDER.join(' → ')} 顺序。`,
          line: found.line,
        })
      } else {
        expectIdx = idx
      }
    }
    return findings
  },
}

export const sectionsRules: LintRule[] = [sectionsRequired]
