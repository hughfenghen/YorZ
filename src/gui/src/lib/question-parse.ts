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
const NEXT_H2_RE = /^##\s+/
const RECOMMEND_SUFFIX_RE = /\s*\(推荐\)\s*$/

/**
 * Parse `## 待确认问题` section into structured questions.
 *
 * A question is a top-level `- ` bullet directly under the heading. Its
 * sub-bullets (`  - ` / `\t- `) become candidate options. A trailing
 * ` (推荐)` marks the recommended option (at most one per question).
 * A question with no sub-bullets degrades to a freeform card.
 *
 * Returns `[]` for a `- 暂无` section or when the heading is absent.
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
    if (NEXT_H2_RE.test(line)) break
    const top = matchTopBullet(line)
    if (!top) {
      i += 1
      continue
    }
    if (top === '暂无') {
      i += 1
      continue
    }
    const options: ConfirmQuestionOption[] = []
    i += 1
    while (i < lines.length) {
      const sub = matchSubBullet(lines[i]!)
      if (sub === null) break
      const recommended = RECOMMEND_SUFFIX_RE.test(sub)
      const label = recommended ? sub.replace(RECOMMEND_SUFFIX_RE, '').trim() : sub.trim()
      if (label) {
        options.push({
          id: optionId(questions.length, options.length, label),
          label,
          recommended,
        })
      }
      i += 1
    }
    questions.push({
      id: questionId(questions.length, top),
      text: top,
      options,
      isFreeform: options.length === 0,
    })
  }
  return questions
}

function matchTopBullet(line: string): string | null {
  const m = /^-\s+(.*\S)\s*$/.exec(line)
  if (!m) return null
  return m[1]!
}

function matchSubBullet(line: string): string | null {
  const m = /^(?:\s{2,}|\t+)-\s+(.*\S)\s*$/.exec(line)
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
