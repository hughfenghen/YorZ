export interface ConfirmQuestionOption {
  id: string
  label: string
  recommended: boolean
}

/**
 * 待确认项类型：
 * - `choice` 抉择型：多个有序候选 + 恰 1 个 (推荐)，给用户选择权。
 * - `confirm` 确认型：单方案 + 影响陈述，给用户否决权。
 * - `freeform` 自由文本：无候选，纯自由批注。
 */
export type ConfirmKind = 'choice' | 'confirm' | 'freeform'

export interface ConfirmQuestion {
  id: string
  text: string
  kind: ConfirmKind
  options: ConfirmQuestionOption[]
  /** = kind === 'freeform'，保留字段以兼容既有调用点。 */
  isFreeform: boolean
  /** 仅 confirm：方案正文（`**方案**：…` 之后的文本）。 */
  plan?: string
  /** 仅 confirm：影响/代价正文（`**影响**：…` 或 `**代价**：…`）。 */
  impact?: string
}

// 章节名兼容新旧：`待确认项`（新）/ `待确认问题`（旧存量 spec）。
const HEADING_RE = /^##\s+(?:\d+(?:\.\d+)*\.?\s+)?待确认(?:项|问题)\s*$/
const NEXT_SECTION_RE = /^##\s+/
const QUESTION_HEADING_RE = /^###\s+(?:\d+(?:\.\d+)*\s+)?(.+\S)\s*$/
const ORDERED_CANDIDATE_RE = /^\d+\.\s+(.*\S)\s*$/
const BLANK_LINE_RE = /^\s*$/
const RECOMMEND_SUFFIX_RE = /\s*[（(]推荐[）)]\s*$/
const FREEFORM_SUFFIX_RE = /\s*（自由文本）\s*$/
// 类型标记前缀：`[choice]` / `[confirm]`（大小写不敏感）。
const KIND_MARKER_RE = /^\[(choice|confirm)\]\s*/i
// confirm 字段行：`**方案**：…` / `**影响**：…` / `**代价**：…`（半/全角冒号皆可）。
const PLAN_FIELD_RE = /^\*\*方案\*\*\s*[:：]\s*(.*\S)?\s*$/
const IMPACT_FIELD_RE = /^\*\*(?:影响|代价)\*\*\s*[:：]\s*(.*\S)?\s*$/

interface RawQuestion {
  headingText: string
  bodyLines: string[]
}

/**
 * Parse `## 待确认项`（兼容旧名 `## 待确认问题`）section into structured items.
 *
 * 新格式：
 * - 每个条目为 `### N.M 正文` 三级标题；编号会被 parser 自动剥离。
 * - 正文可带类型标记前缀 `[choice]` / `[confirm]`：
 *   - `[confirm]`：确认型，正文下方以 `**方案**：…` / `**影响**：…`（或 `**代价**`）描述，不列候选。
 *   - `[choice]` 或无标记：抉择型，候选写作一级有序列表，恰 1 个候选可 ` (推荐)` / ` （推荐）` 结尾。
 * - 正文以 `（自由文本）` 结尾时视为自由文本（freeform，不带候选）。
 * - 空态：整章仅 `_暂无_` 或无内容，返回 `[]`。
 *
 * 扫描在下一个 `## ` 二级标题处终止；`### ` 无条件视作新条目起点。
 */
export function parseConfirmQuestions(body: string): ConfirmQuestion[] {
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length && !HEADING_RE.test(lines[i]!)) i += 1
  if (i >= lines.length) return []
  i += 1 // skip heading

  // 第一遍：切出每个条目的标题与原始正文行。
  const raws: RawQuestion[] = []
  let current: RawQuestion | null = null
  while (i < lines.length) {
    const line = lines[i]!
    if (NEXT_SECTION_RE.test(line)) break
    const heading = matchQuestionHeading(line)
    if (heading) {
      current = { headingText: heading, bodyLines: [] }
      raws.push(current)
    } else if (current) {
      current.bodyLines.push(line)
    }
    i += 1
  }

  // 第二遍：分型解析。
  return raws.map((raw, index) => classify(raw, index))
}

function classify(raw: RawQuestion, index: number): ConfirmQuestion {
  const markerMatch = KIND_MARKER_RE.exec(raw.headingText)
  const marker = markerMatch?.[1]?.toLowerCase()
  const afterMarker = markerMatch ? raw.headingText.slice(markerMatch[0].length) : raw.headingText

  const freeformSuffix = FREEFORM_SUFFIX_RE.test(afterMarker)
  const text = freeformSuffix ? afterMarker.replace(FREEFORM_SUFFIX_RE, '').trim() : afterMarker.trim()

  if (marker === 'confirm') {
    const { plan, impact } = parseConfirmFields(raw.bodyLines)
    return {
      id: questionId(index, text),
      text,
      kind: 'confirm',
      options: [],
      isFreeform: false,
      plan,
      impact,
    }
  }

  // choice / freeform：沿用有序候选解析。
  const options = parseOrderedOptions(raw.bodyLines, index, text)
  const isFreeform = freeformSuffix || options.length === 0
  return {
    id: questionId(index, text),
    text,
    kind: isFreeform ? 'freeform' : 'choice',
    options,
    isFreeform,
  }
}

function parseConfirmFields(bodyLines: string[]): { plan?: string; impact?: string } {
  let plan: string | undefined
  let impact: string | undefined
  for (const raw of bodyLines) {
    const line = raw.trim()
    const planMatch = PLAN_FIELD_RE.exec(line)
    if (planMatch) {
      plan = planMatch[1]?.trim() || ''
      continue
    }
    const impactMatch = IMPACT_FIELD_RE.exec(line)
    if (impactMatch) impact = impactMatch[1]?.trim() || ''
  }
  return { plan, impact }
}

function parseOrderedOptions(
  bodyLines: string[],
  qIndex: number,
  text: string,
): ConfirmQuestionOption[] {
  const options: ConfirmQuestionOption[] = []
  let originalRecommendedCount = 0
  for (const raw of bodyLines) {
    if (BLANK_LINE_RE.test(raw)) continue
    const candidate = matchOrderedCandidate(raw)
    if (candidate === null) continue
    const recommended = RECOMMEND_SUFFIX_RE.test(candidate)
    const label = recommended ? candidate.replace(RECOMMEND_SUFFIX_RE, '').trim() : candidate.trim()
    if (!label) continue
    if (recommended) originalRecommendedCount += 1
    options.push({
      id: optionId(qIndex, options.length, label),
      label,
      // 多 (推荐) 时仅首个保留，其余降级为普通选项
      recommended: recommended && originalRecommendedCount === 1,
    })
  }
  if (originalRecommendedCount >= 2) {
    console.warn(
      `[question-parse] 问题 "${text}" 含 ${originalRecommendedCount} 个 (推荐)，已保留首个，其余降级`,
    )
  }
  return options
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
