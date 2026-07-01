export interface ConfirmQuestionOption {
  id: string
  label: string
  recommended: boolean
}

export interface ConfirmQuestion {
  id: string
  text: string
  options: ConfirmQuestionOption[]
  isFreeform: boolean
}

const HEADING_RE = /^##\s+(?:\d+(?:\.\d+)*\.?\s+)?待确认问题\s*$/
const NEXT_SECTION_RE = /^##\s+/
const QUESTION_HEADING_RE = /^###\s+(?:\d+(?:\.\d+)*\s+)?(.+\S)\s*$/
const ORDERED_CANDIDATE_RE = /^\d+\.\s+(.*\S)\s*$/
const BLANK_LINE_RE = /^\s*$/
const RECOMMEND_SUFFIX_RE = /\s*[（(]推荐[）)]\s*$/
const FREEFORM_SUFFIX_RE = /\s*（自由文本）\s*$/

/**
 * Parse `## 待确认问题` section into structured questions.
 *
 * 新格式（硬切换）：
 * - 每个问题为 `### N.M 问题正文` 三级标题；编号会被 parser 自动剥离，只保留问题正文。
 * - 候选写作一级有序列表 `1. 文本` / `2. 文本` …；恰 1 个候选可以 ` (推荐)` 或 ` （推荐）` 结尾（半/全角括号皆可）。
 * - 问题正文以 `（自由文本）` 结尾时视为自由文本（不带有序列表候选）。
 * - 空态：整章仅 `_暂无_` 或无内容，返回 `[]`。
 *
 * 扫描在下一个 `## ` 二级标题处终止；`### ` 无条件视作新问题起点，
 * 因此不支持在本章节内嵌 `### 已确认决策快照` 之类的辅助子节
 * （若需要，应放到独立的二级章节）。
 */
export function parseConfirmQuestions(body: string): ConfirmQuestion[] {
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length && !HEADING_RE.test(lines[i]!)) i += 1
  if (i >= lines.length) return []
  i += 1 // skip heading

  const questions: ConfirmQuestion[] = []
  while (i < lines.length) {
    const line = lines[i]!
    if (NEXT_SECTION_RE.test(line)) break
    const heading = matchQuestionHeading(line)
    if (!heading) {
      i += 1
      continue
    }
    const freeformSuffix = FREEFORM_SUFFIX_RE.test(heading)
    const text = freeformSuffix ? heading.replace(FREEFORM_SUFFIX_RE, '').trim() : heading
    const options: ConfirmQuestionOption[] = []
    let originalRecommendedCount = 0
    i += 1
    while (i < lines.length) {
      const current = lines[i]!
      if (BLANK_LINE_RE.test(current)) {
        i += 1
        continue
      }
      if (NEXT_SECTION_RE.test(current) || QUESTION_HEADING_RE.test(current)) break
      const candidate = matchOrderedCandidate(current)
      if (candidate === null) {
        i += 1
        continue
      }
      const recommended = RECOMMEND_SUFFIX_RE.test(candidate)
      const label = recommended
        ? candidate.replace(RECOMMEND_SUFFIX_RE, '').trim()
        : candidate.trim()
      if (label) {
        if (recommended) originalRecommendedCount += 1
        options.push({
          id: optionId(questions.length, options.length, label),
          label,
          // 多 (推荐) 时仅首个保留，其余降级为普通选项
          recommended: recommended && originalRecommendedCount === 1,
        })
      }
      i += 1
    }
    if (originalRecommendedCount >= 2) {
      console.warn(
        `[question-parse] 问题 "${text}" 含 ${originalRecommendedCount} 个 (推荐)，已保留首个，其余降级`,
      )
    }
    questions.push({
      id: questionId(questions.length, text),
      text,
      options,
      isFreeform: freeformSuffix || options.length === 0,
    })
  }
  return questions
}

function matchQuestionHeading(line: string): string | null {
  const m = QUESTION_HEADING_RE.exec(line)
  if (!m) return null
  return m[1]!
}

function matchOrderedCandidate(line: string): string | null {
  const m = ORDERED_CANDIDATE_RE.exec(line)
  if (!m) return null
  return m[1]!
}

function questionId(index: number, text: string): string {
  return `q-${index}-${hash(text)}`
}

function optionId(qIndex: number, oIndex: number, label: string): string {
  return `q-${qIndex}-o-${oIndex}-${hash(label)}`
}

function hash(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}
