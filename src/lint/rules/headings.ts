import type { LintContext, LintFinding, LintRule } from '../types.js'

const REQUIRED_SECTIONS = [
  '背景',
  '需求',
  '现状分析',
  '技术实现方案',
  '待确认问题',
  '任务清单',
  '执行记录',
]

// 可选章节：`追加任务` 由用户额外操作产生，不作为必备章节，但一旦以 H1 出现同样需要提示
// 层级违规（保持"章节级别应为 H2"的直觉）。
const OPTIONAL_SECTIONS = ['追加任务']

interface HeadingInfo {
  level: number
  text: string
  line: number
}

export const HEADING_NUMBER_PREFIX_RE = /^\d+(?:\.\d+)*\.?\s+/

export function stripHeadingNumber(text: string): string {
  return text.replace(HEADING_NUMBER_PREFIX_RE, '').trim()
}

export function collectHeadings(ctx: LintContext): HeadingInfo[] {
  const list: HeadingInfo[] = []
  let inFence = false
  for (let i = ctx.bodyStartLine; i < ctx.rawLines.length; i += 1) {
    const raw = ctx.rawLines[i] ?? ''
    if (/^```/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^(#{1,6})\s+(.*)$/.exec(raw)
    if (!m) continue
    list.push({ level: m[1]!.length, text: m[2]!.trim(), line: i + 1 })
  }
  return list
}

export const headingH1Single: LintRule = {
  id: 'heading/h1-single',
  description: 'body 中一级标题 (# ) 恰出现一次，且位于所有二级标题之前。',
  kinds: ['spec'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const headings = collectHeadings(ctx)
    const h1s = headings.filter((h) => h.level === 1)
    if (h1s.length === 0) {
      findings.push({
        ruleId: this.id,
        severity: 'error',
        message: 'body 中缺少一级标题 (# )。spec 顶部必须有 # <标题>。',
        line: ctx.bodyStartLine + 1,
      })
      return findings
    }
    if (h1s.length > 1) {
      for (const h of h1s.slice(1)) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `body 中出现多个一级标题；只允许一个 # 作为文档标题。`,
          line: h.line,
        })
      }
    }
    const firstH2 = headings.find((h) => h.level === 2)
    if (firstH2 && h1s[0]!.line > firstH2.line) {
      findings.push({
        ruleId: this.id,
        severity: 'error',
        message: '一级标题必须位于所有二级标题之前。',
        line: h1s[0]!.line,
      })
    }
    return findings
  },
}

export const headingSectionLevel: LintRule = {
  id: 'heading/section-level',
  description: '七大必备章节及 `追加任务` 可选章节必须以 `## ` 出现，不允许写成 `# `。',
  kinds: ['spec'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const headings = collectHeadings(ctx)
    const knownSections = [...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS]
    for (const h of headings) {
      if (h.level === 1) continue
      const bareText = stripHeadingNumber(h.text)
      if (knownSections.includes(bareText) && h.level !== 2) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `章节 "${bareText}" 必须使用二级标题 (## )，当前为 ${'#'.repeat(h.level)}。`,
          line: h.line,
        })
      }
    }
    // Also flag H1 lines whose text matches a known section (e.g. `# 背景`).
    for (const h of headings) {
      if (h.level !== 1) continue
      const bareText = stripHeadingNumber(h.text)
      if (knownSections.includes(bareText)) {
        findings.push({
          ruleId: this.id,
          severity: 'error',
          message: `一级标题 "${h.text}" 疑似把章节写成 # ；章节标题应为 ## 。`,
          line: h.line,
        })
      }
    }
    return findings
  },
}

export const headingNumbering: LintRule = {
  id: 'heading/numbering',
  description: '`## ` 按出现顺序 `N. ` 连续；`### ` 在所属二级下 `N.M` 连续、不跳号。',
  kinds: ['spec'],
  check(ctx: LintContext): LintFinding[] {
    const findings: LintFinding[] = []
    const headings = collectHeadings(ctx)
    let h2Index = 0
    let h3Index = 0
    for (const h of headings) {
      if (h.level === 2) {
        h2Index += 1
        h3Index = 0
        const m = /^(\d+)\.\s+/.exec(h.text)
        if (!m) {
          findings.push({
            ruleId: 'heading/numbering',
            severity: 'error',
            message: `二级标题必须带编号 "## ${h2Index}. ..."：${h.text}`,
            line: h.line,
          })
        } else if (Number.parseInt(m[1]!, 10) !== h2Index) {
          findings.push({
            ruleId: 'heading/numbering',
            severity: 'error',
            message: `二级标题编号应为 ${h2Index}. ，实为 ${m[1]}. ：${h.text}`,
            line: h.line,
          })
        }
      } else if (h.level === 3) {
        h3Index += 1
        const m = /^(\d+)\.(\d+)\s+/.exec(h.text)
        if (!m) {
          findings.push({
            ruleId: 'heading/numbering',
            severity: 'error',
            message: `三级标题必须带编号 "### ${h2Index}.${h3Index} ..."：${h.text}`,
            line: h.line,
          })
        } else if (
          Number.parseInt(m[1]!, 10) !== h2Index ||
          Number.parseInt(m[2]!, 10) !== h3Index
        ) {
          findings.push({
            ruleId: 'heading/numbering',
            severity: 'error',
            message: `三级标题编号应为 ${h2Index}.${h3Index} ，实为 ${m[1]}.${m[2]} ：${h.text}`,
            line: h.line,
          })
        }
      }
    }
    return findings
  },
}

export const headingRules: LintRule[] = [headingH1Single, headingSectionLevel, headingNumbering]
