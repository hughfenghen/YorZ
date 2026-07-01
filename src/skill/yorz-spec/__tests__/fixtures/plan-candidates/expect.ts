import type { AssertResult, ParsedSpec } from '../../runner.js'

/**
 * Verify the `## 待确认问题` block follows the candidate hard-constraint:
 * each `### N.M 问题正文` heading either
 *   - has 2+ child ordered-list candidates (`1. / 2. / …`) with EXACTLY one
 *     ending in ` (推荐)` or ` （推荐）`, OR
 *   - ends in `（自由文本）` (no child candidates required).
 *
 * Also asserts at least one question was produced (the fixture has 4 explicit
 * unknowns in 需求, so plan must surface SOMETHING).
 */
export async function assert(parsed: ParsedSpec): Promise<AssertResult> {
  const failures: string[] = []
  const rules: string[] = []

  rules.push('frontmatter.stage === plan')
  if (parsed.frontmatter.stage !== 'plan') {
    failures.push(`stage expected plan, got ${String(parsed.frontmatter.stage)}`)
  }

  rules.push('## 待确认问题 section exists')
  const section = extractSection(parsed.body, '待确认问题')
  if (!section) {
    failures.push('## 待确认问题 section not found')
    return finalize(failures, rules)
  }

  rules.push('待确认问题 contains at least 1 real question')
  const questions = parseQuestions(section)
  if (questions.length === 0 || section.trim() === '_暂无_') {
    failures.push('待确认问题 produced 0 questions despite 4 explicit unknowns in 需求')
  }

  for (const q of questions) {
    rules.push(`question candidate-format: "${truncate(q.text, 40)}"`)
    const hasCandidates = q.children.length > 0
    const isFreeText = /（自由文本）\s*$/.test(q.text)
    if (!hasCandidates && !isFreeText) {
      failures.push(`question lacks candidates AND lacks （自由文本） suffix: "${q.text}"`)
      continue
    }
    if (hasCandidates) {
      const recommended = q.children.filter(
        (c) => /\s\(推荐\)\s*$/.test(c) || /\s（推荐）\s*$/.test(c),
      )
      if (recommended.length !== 1) {
        failures.push(
          `question "${truncate(q.text, 40)}" should have exactly 1 candidate ending with (推荐), got ${recommended.length}`,
        )
      }
    }
  }
  return finalize(failures, rules)
}

interface ParsedQuestion {
  text: string
  children: string[]
}

function extractSection(body: string, titleSuffix: string): string | null {
  const lines = body.split('\n')
  let inSection = false
  const out: string[] = []
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      if (inSection) break
      if (line.includes(titleSuffix)) inSection = true
      continue
    }
    if (inSection) out.push(line)
  }
  return inSection ? out.join('\n').trim() : null
}

function parseQuestions(section: string): ParsedQuestion[] {
  const lines = section.split('\n')
  const out: ParsedQuestion[] = []
  let cur: ParsedQuestion | null = null
  for (const line of lines) {
    const headingMatch = /^###\s+(?:\d+(?:\.\d+)*\s+)?(.+\S)\s*$/.exec(line)
    if (headingMatch) {
      if (cur) out.push(cur)
      cur = { text: headingMatch[1]!.trim(), children: [] }
      continue
    }
    const candidateMatch = /^\d+\.\s+(.*\S)\s*$/.exec(line)
    if (candidateMatch) {
      cur?.children.push(candidateMatch[1]!.trim())
    }
  }
  if (cur) out.push(cur)
  return out
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function finalize(failures: string[], rules: string[]): AssertResult {
  return { failures, hitRules: rules.length - failures.length, totalRules: rules.length }
}
