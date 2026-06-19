import { describe, it, expect } from 'vitest'
import { buildAnswerItem, FREEFORM_SENTINEL } from '../answer-payload.js'

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
