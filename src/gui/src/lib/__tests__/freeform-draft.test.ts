import { describe, it, expect } from 'vitest'
import {
  newFreeformId,
  toAnnotationBodies,
  type FreeformDraft,
} from '@shared/lib/question-draft.js'

const draft = (overrides: Partial<FreeformDraft> = {}): FreeformDraft => ({
  id: 'f-1',
  sectionPath: '## 3. 现状分析',
  quote: '移动端没有正文选区能力',
  note: '这里要补一下',
  ...overrides,
})

describe('toAnnotationBodies', () => {
  it('只输出服务端校验的三个字段，丢掉 id', () => {
    expect(toAnnotationBodies([draft()])).toEqual([
      {
        sectionPath: '## 3. 现状分析',
        quote: '移动端没有正文选区能力',
        note: '这里要补一下',
      },
    ])
  })

  it('保持顺序，空数组进空数组出', () => {
    const out = toAnnotationBodies([draft({ id: 'a', note: '一' }), draft({ id: 'b', note: '二' })])
    expect(out.map((a) => a.note)).toEqual(['一', '二'])
    expect(toAnnotationBodies([])).toEqual([])
  })
})

describe('newFreeformId', () => {
  it('同一批次内靠 index 区分，互不重复', () => {
    expect(newFreeformId(0)).not.toBe(newFreeformId(1))
  })

  it('形如 f-<ts>-<index>', () => {
    expect(newFreeformId(3)).toMatch(/^f-\d+-3$/)
  })
})
