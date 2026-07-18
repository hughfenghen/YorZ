import type { QuestionAnswerBody } from './api.js'

export const FREEFORM_SENTINEL = '__freeform__'

/**
 * 确认型（`[confirm]`）待确认项的规范决策 label。
 *
 * 决策不改动 API/spec-store：编码进现有 `selectedOptionLabel`（承载结构化意图）
 * 与 `note`（承载理由）。Agent 在 tasks 阶段按 label 分派下游行为
 * （见 skill `stages.md` 的「确认型答复消费」）。
 */
export const CONFIRM_DECISIONS = {
  accept: '确认，按此推进',
  rejectAlternative: '否决·换方案',
  rejectConstraint: '否决·补约束',
  rejectDropGoal: '否决·弃目标·废弃当前目标，继续其余',
  rejectDropSpec: '否决·弃目标·放弃整个 spec',
} as const

export type ConfirmDecisionKey = keyof typeof CONFIRM_DECISIONS

export const CONFIRM_ACCEPT_KEY: ConfirmDecisionKey = 'accept'

/** 除 accept 外均为否决决策；否决必须携带理由。 */
export function isRejectDecision(key: ConfirmDecisionKey): boolean {
  return key !== CONFIRM_ACCEPT_KEY
}

/**
 * 构造确认型待确认项的答复。
 * - accept：理由可空，仅回写 `选择：确认，按此推进`。
 * - 任一否决：理由必填，空理由返回 null（提交被阻塞）。
 */
export function buildConfirmAnswerItem(
  question: { id: string; text: string },
  key: ConfirmDecisionKey,
  note: string,
): QuestionAnswerBody | null {
  const label = CONFIRM_DECISIONS[key]
  const trimmed = (note ?? '').trim()
  if (isRejectDecision(key) && !trimmed) return null
  const item: QuestionAnswerBody = {
    questionId: question.id,
    questionText: question.text,
    selectedOptionLabel: label,
  }
  if (trimmed) item.note = trimmed
  return item
}

export interface AnswerDraftLike {
  selectedOptionLabel?: string
  note: string
}

export interface AnswerableQuestion {
  id: string
  text: string
  isFreeform: boolean
}

export function buildAnswerItem(
  question: AnswerableQuestion,
  draft: AnswerDraftLike,
): QuestionAnswerBody | null {
  const trimmedNote = (draft.note ?? '').trim()
  if (question.isFreeform) {
    if (!trimmedNote) return null
    return { questionId: question.id, questionText: question.text, note: trimmedNote }
  }
  const label = draft.selectedOptionLabel
  if (label === FREEFORM_SENTINEL) {
    if (!trimmedNote) return null
    return { questionId: question.id, questionText: question.text, note: trimmedNote }
  }
  if (label) {
    return { questionId: question.id, questionText: question.text, selectedOptionLabel: label }
  }
  return null
}
