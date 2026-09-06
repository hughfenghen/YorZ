import type { AnnotationBody, QuestionAnswerBody } from '../api/index.js'
import {
  buildAnswerItem,
  buildConfirmAnswerItem,
  FREEFORM_SENTINEL,
  type ConfirmDecisionKey,
} from './answer-payload.js'
import type { ConfirmQuestion } from './question-parse.js'

/**
 * The answer-draft state machine behind the 待确认项 form, shared by desktop's
 * side panel and mobile's bottom sheet.
 *
 * The two UIs look nothing alike — desktop nests Kobalte RadioGroups, mobile
 * expands the levels in place — but "what counts as answered" and "what payload
 * does this draft produce" must not drift between them, or the `！！！选择：…`
 * text written back into the spec would differ per client. So the predicates and
 * the payload construction live here; only the widgets are per-platform.
 */

/** confirm 型的三级否决意图状态。 */
export type ConfirmTop = 'accept' | 'reject'
export type RejectIntent = 'alternative' | 'constraint' | 'dropGoal'
export type DropTarget = 'current' | 'spec'

export interface AnswerDraft {
  // choice / freeform
  selectedOptionLabel?: string
  note: string
  // confirm
  confirmTop?: ConfirmTop
  confirmIntent?: RejectIntent
  confirmDrop?: DropTarget
}

/** 把三级 confirm 选择折叠为规范决策 key；未选全返回 null。 */
export function resolveConfirmKey(d: AnswerDraft): ConfirmDecisionKey | null {
  if (d.confirmTop === 'accept') return 'accept'
  if (d.confirmTop !== 'reject') return null
  if (d.confirmIntent === 'alternative') return 'rejectAlternative'
  if (d.confirmIntent === 'constraint') return 'rejectConstraint'
  if (d.confirmIntent === 'dropGoal') {
    if (d.confirmDrop === 'current') return 'rejectDropGoal'
    if (d.confirmDrop === 'spec') return 'rejectDropSpec'
  }
  return null
}

/** confirm 草稿是否完整可提交（已选决策；若否决则理由非空）。 */
export function isConfirmComplete(d: AnswerDraft): boolean {
  const key = resolveConfirmKey(d)
  if (!key) return false
  if (key === 'accept') return true
  return d.note.trim().length > 0
}

/**
 * 每个条目的初始草稿。
 *
 * 确认型默认「确认，按此推进」——它是知会 + 急停语义，放行是常态；
 * 抉择型默认选中带 `(推荐)` 的候选，没有推荐时退到第一项。
 */
export function initialAnswers(questions: ConfirmQuestion[]): Record<string, AnswerDraft> {
  const out: Record<string, AnswerDraft> = {}
  for (const q of questions) {
    if (q.kind === 'confirm') {
      out[q.id] = { note: '', confirmTop: 'accept' }
      continue
    }
    const recommended = q.options.find((o) => o.recommended)
    out[q.id] = {
      selectedOptionLabel: recommended?.label ?? q.options[0]?.label,
      note: '',
    }
  }
  return out
}

/** 尚未答完的条目数（0 表示可以干净地提交）。 */
export function countUnanswered(
  questions: ConfirmQuestion[],
  answers: Record<string, AnswerDraft>,
): number {
  let count = 0
  for (const q of questions) {
    const draft = answers[q.id]
    if (!draft) {
      count += 1
      continue
    }
    if (q.kind === 'confirm') {
      if (!isConfirmComplete(draft)) count += 1
      continue
    }
    const note = draft.note ?? ''
    if (q.isFreeform) {
      if (!note.trim()) count += 1
    } else if (draft.selectedOptionLabel === FREEFORM_SENTINEL) {
      if (!note.trim()) count += 1
    } else if (!draft.selectedOptionLabel) {
      count += 1
    }
  }
  return count
}

export type BuildAnswersResult =
  | { ok: true; items: QuestionAnswerBody[] }
  /** 否决却没写理由：整次提交必须停下，由调用方渲染文案。 */
  | { ok: false; reason: 'reasonRequired' }

/**
 * 把草稿折叠成提交条目。confirm 未选决策的条目视作未答直接跳过，
 * 但「已选否决 + 缺理由」是硬错误——`buildConfirmAnswerItem` 返回 null 即为此。
 */
export function buildAnswerItems(
  questions: ConfirmQuestion[],
  answers: Record<string, AnswerDraft>,
): BuildAnswersResult {
  const items: QuestionAnswerBody[] = []
  for (const q of questions) {
    const draft = answers[q.id] ?? { note: '' }
    if (q.kind === 'confirm') {
      const key = resolveConfirmKey(draft)
      if (!key) continue
      const item = buildConfirmAnswerItem(q, key, draft.note)
      if (!item) return { ok: false, reason: 'reasonRequired' }
      items.push(item)
      continue
    }
    const item = buildAnswerItem(q, draft)
    if (item) items.push(item)
  }
  return { ok: true, items }
}

/**
 * 选区批注的本地草稿。
 *
 * 它与 `AnswerDraft` 走的是两条不同的寿命：答案草稿随面板/弹窗开合重置，
 * 批注草稿是页面级的，可以攒好几条再和答案一起提交。`id` 只服务于列表 key
 * 与删除，**不进 payload**——服务端不认这个字段。
 */
export interface FreeformDraft {
  id: string
  sectionPath: string
  quote: string
  note: string
}

/** 生成草稿 id。同一毫秒内连续批注靠 index 区分。 */
export function newFreeformId(index: number): string {
  return `f-${Date.now()}-${index}`
}

/**
 * 草稿 → 提交体：丢掉 `id`，只留服务端校验的三个字段
 * （`routes/specs.ts` 要求三者均为非空字符串，否则整个请求 400）。
 */
export function toAnnotationBodies(drafts: readonly FreeformDraft[]): AnnotationBody[] {
  return drafts.map(
    (f): AnnotationBody => ({
      sectionPath: f.sectionPath,
      quote: f.quote,
      note: f.note,
    }),
  )
}

/** 影响文本含 🔴 → 高危红边，🟡 → 中危黄边。两端共用同一套设计 token。 */
export function impactAccent(impact: string | undefined): string {
  if (!impact) return 'border-border'
  if (impact.includes('🔴')) return 'border-l-2 border-l-destructive'
  if (impact.includes('🟡')) return 'border-l-2 border-l-warning'
  return 'border-border'
}
