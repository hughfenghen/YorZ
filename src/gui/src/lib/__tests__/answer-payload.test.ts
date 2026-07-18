import { describe, it, expect } from 'vitest'
import {
  buildAnswerItem,
  buildConfirmAnswerItem,
  CONFIRM_DECISIONS,
  isRejectDecision,
  FREEFORM_SENTINEL,
} from '../answer-payload.js'

const q = (overrides: Partial<{ id: string; text: string; isFreeform: boolean }> = {}) => ({
  id: 'q-0',
  text: '用什么数据库？',
  isFreeform: false,
  ...overrides,
})

describe('buildAnswerItem', () => {
  it('keeps only selectedOptionLabel when a normal option is chosen', () => {
    const item = buildAnswerItem(q(), { selectedOptionLabel: 'SQLite', note: '' })
    expect(item).toEqual({
      questionId: 'q-0',
      questionText: '用什么数据库？',
      selectedOptionLabel: 'SQLite',
    })
    expect(item).not.toHaveProperty('note')
  })

  it('drops note when a normal option is chosen even if note is written', () => {
    const item = buildAnswerItem(q(), {
      selectedOptionLabel: 'SQLite',
      note: '附带备注会被丢弃',
    })
    expect(item).toEqual({
      questionId: 'q-0',
      questionText: '用什么数据库？',
      selectedOptionLabel: 'SQLite',
    })
  })

  it('keeps only note when the freeform sentinel is selected with text', () => {
    const item = buildAnswerItem(q(), {
      selectedOptionLabel: FREEFORM_SENTINEL,
      note: '我的自定义答复',
    })
    expect(item).toEqual({
      questionId: 'q-0',
      questionText: '用什么数据库？',
      note: '我的自定义答复',
    })
    expect(item).not.toHaveProperty('selectedOptionLabel')
  })

  it('returns null when the sentinel is selected but the note is empty', () => {
    const item = buildAnswerItem(q(), { selectedOptionLabel: FREEFORM_SENTINEL, note: '  ' })
    expect(item).toBeNull()
  })

  it('keeps only note for a freeform question', () => {
    const item = buildAnswerItem(q({ isFreeform: true }), { note: '一段自由答复' })
    expect(item).toEqual({
      questionId: 'q-0',
      questionText: '用什么数据库？',
      note: '一段自由答复',
    })
  })

  it('returns null for a freeform question without note', () => {
    const item = buildAnswerItem(q({ isFreeform: true }), { note: '' })
    expect(item).toBeNull()
  })
})

describe('buildConfirmAnswerItem', () => {
  const cq = { id: 'q-0', text: '迁移 UserID 为 uuid' }

  it('accept keeps only the label, note optional', () => {
    const item = buildConfirmAnswerItem(cq, 'accept', '')
    expect(item).toEqual({
      questionId: 'q-0',
      questionText: '迁移 UserID 为 uuid',
      selectedOptionLabel: CONFIRM_DECISIONS.accept,
    })
    expect(item).not.toHaveProperty('note')
  })

  it('accept keeps an optional note when provided', () => {
    const item = buildConfirmAnswerItem(cq, 'accept', '同意，尽快做')
    expect(item).toEqual({
      questionId: 'q-0',
      questionText: '迁移 UserID 为 uuid',
      selectedOptionLabel: CONFIRM_DECISIONS.accept,
      note: '同意，尽快做',
    })
  })

  it.each([
    ['rejectAlternative', CONFIRM_DECISIONS.rejectAlternative],
    ['rejectConstraint', CONFIRM_DECISIONS.rejectConstraint],
    ['rejectDropGoal', CONFIRM_DECISIONS.rejectDropGoal],
    ['rejectDropSpec', CONFIRM_DECISIONS.rejectDropSpec],
  ] as const)('reject decision %s carries label + reason', (key, label) => {
    const item = buildConfirmAnswerItem(cq, key, '当前无停机窗口')
    expect(item).toEqual({
      questionId: 'q-0',
      questionText: '迁移 UserID 为 uuid',
      selectedOptionLabel: label,
      note: '当前无停机窗口',
    })
  })

  it('returns null when a reject decision has an empty reason', () => {
    expect(buildConfirmAnswerItem(cq, 'rejectDropSpec', '   ')).toBeNull()
  })

  it('isRejectDecision distinguishes accept from rejects', () => {
    expect(isRejectDecision('accept')).toBe(false)
    expect(isRejectDecision('rejectDropSpec')).toBe(true)
  })
})
