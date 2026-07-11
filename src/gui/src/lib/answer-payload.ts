import type { QuestionAnswerBody } from './api.js'

export const FREEFORM_SENTINEL = '__freeform__'

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
