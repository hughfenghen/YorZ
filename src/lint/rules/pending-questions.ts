import type { LintContext, LintFinding, LintRule } from '../types.js'
import { collectHeadings, stripHeadingNumber } from './headings.js'

interface SectionRange {
  startLine: number
  endLine: number
}

function findPendingSection(ctx: LintContext): SectionRange | null {
  const headings = collectHeadings(ctx)
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i]!
    if (h.level !== 2) continue
    const bare = stripHeadingNumber(h.text)
    if (bare !== '待确认问题') continue
    const next = headings.slice(i + 1).find((x) => x.level === 2)
    const startLine = h.line
    const endLine = next ? next.line - 1 : ctx.rawLines.length
    return { startLine, endLine }
  }
  return null
}

interface Question {
  headingLine: number
  headingText: string
  bodyLines: string[]
  bodyStartLine: number
}

function collectQuestions(ctx: LintContext, section: SectionRange): Question[] {
  const questions: Question[] = []
  let current: Question | null = null
  for (let ln = section.startLine; ln < section.endLine; ln += 1) {
    const raw = ctx.rawLines[ln] ?? ''
    const m = /^###\s+(.*)$/.exec(raw)
    if (m) {
      if (current) questions.push(current)
      current = {
        headingLine: ln + 1,
        headingText: m[1]!.trim(),
        bodyLines: [],
        bodyStartLine: ln + 2,
      }
      continue
    }
    if (current) current.bodyLines.push(raw)
  }
  if (current) questions.push(current)
  return questions
}

export const pendingQuestionsStructure: LintRule = {
  id: 'pending-questions/structure',
  description: '每条问题为 ### N.M 三级标题；候选项用 1. 有序列表；恰 1 个 (推荐)；或标题以 （自由文本）结尾。',
  kinds: ['spec'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const section = findPendingSection(ctx)
    if (!section) return findings
    const questions = collectQuestions(ctx, section)
    for (const q of questions) {
      const isFreeform = /（自由文本）\s*$/.test(q.headingText)
      // Collect candidate ordered-list items (top-level, non-indented).
      const orderedItems: { line: number; text: string }[] = []
      const unorderedItems: { line: number; text: string }[] = []
      for (let i = 0; i < q.bodyLines.length; i += 1) {
        const raw = q.bodyLines[i] ?? ''
        const ln = q.bodyStartLine + i
        const orderedMatch = /^(\d+)\.\s+(.*)$/.exec(raw)
        const unorderedMatch = /^-\s+(.*)$/.exec(raw)
        if (orderedMatch) orderedItems.push({ line: ln, text: orderedMatch[2]! })
        else if (unorderedMatch) unorderedItems.push({ line: ln, text: unorderedMatch[1]! })
      }
      if (isFreeform) {
        // Freeform: MUST NOT have candidates.
        if (orderedItems.length > 0 || unorderedItems.length > 0) {
          findings.push({
            ruleId: this.id,
            severity: 'error',
            message: `问题 "${q.headingText}" 已标 （自由文本），不应再列候选项。`,
            line: q.headingLine,
          })
        }
        continue
      }
      // Non-freeform: must have ordered-list candidates.
      if (unorderedItems.length > 0 && orderedItems.length === 0) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `问题 "${q.headingText}" 候选项应使用一级有序列表 (1. 2. 3.)，禁止无序 - 列表。`,
          line: unorderedItems[0]!.line,
        })
      }
      if (orderedItems.length === 0) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `问题 "${q.headingText}" 缺少候选项，且未标 （自由文本）。请补齐有序候选或加自由文本后缀。`,
          line: q.headingLine,
        })
        continue
      }
      const recommendCount = orderedItems.filter((it) => / (?:\(推荐\)|（推荐）)\s*$/.test(it.text))
        .length
      if (recommendCount !== 1) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `问题 "${q.headingText}" 必须有恰 1 个 (推荐) / （推荐），实际 ${recommendCount} 个。`,
          line: q.headingLine,
        })
      }
    }
    return findings
  },
}

export const pendingQuestionsEmpty: LintRule = {
  id: 'pending-questions/empty',
  description: '空态整章仅一行 _暂无_ 斜体段落，不允许 - 暂无 或空章节。',
  kinds: ['spec'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const section = findPendingSection(ctx)
    if (!section) return findings
    const questions = collectQuestions(ctx, section)
    if (questions.length > 0) return findings
    // No questions — must be `_暂无_` on some line inside the section.
    const bodyContent = ctx.rawLines
      .slice(section.startLine, section.endLine)
      .slice(1)
      .filter((l) => l.trim().length > 0)
    const hasPlaceholder = bodyContent.some((l) => l.trim() === '_暂无_')
    const hasBadDash = bodyContent.some((l) => /^-\s*暂无\s*$/.test(l.trim()))
    if (hasBadDash) {
      findings.push({
        ruleId: this.id,
        severity: 'error',
        message: '空态应写为斜体段落 `_暂无_`，而不是 `- 暂无` 列表项。',
        line: section.startLine + 1,
      })
      return findings
    }
    if (!hasPlaceholder) {
      findings.push({
        ruleId: this.id,
        severity: 'error',
        message: '`## 待确认问题` 章节为空时应写一行 `_暂无_` 斜体段落。',
        line: section.startLine + 1,
      })
    }
    return findings
  },
}

export const pendingQuestionsNoNamedRecommend: LintRule = {
  id: 'pending-questions/no-named-recommend',
  description: '候选项列表中不允许出现以 "推荐：" 开头的独立条目。',
  kinds: ['spec'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const section = findPendingSection(ctx)
    if (!section) return findings
    const questions = collectQuestions(ctx, section)
    for (const q of questions) {
      for (let i = 0; i < q.bodyLines.length; i += 1) {
        const raw = q.bodyLines[i] ?? ''
        const m = /^\d+\.\s+(.*)$/.exec(raw)
        if (!m) continue
        const text = m[1]!.trim()
        if (/^推荐[:：]/.test(text)) {
          findings.push({
            ruleId: this.id,
            severity: 'error',
            message: `候选项不应新增以 "推荐：" 为名的独立条目：${text}`,
            line: q.bodyStartLine + i,
          })
        }
      }
    }
    return findings
  },
}

export const pendingQuestionsRules: LintRule[] = [
  pendingQuestionsStructure,
  pendingQuestionsEmpty,
  pendingQuestionsNoNamedRecommend,
]
