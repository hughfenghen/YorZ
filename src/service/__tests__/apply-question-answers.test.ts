import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpecStore } from '../spec-store.js'

async function makeStore(date = new Date('2026-06-18T10:00:00Z')) {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-qa-'))
  const store = new SpecStore({ cwd, now: () => date })
  await store.ensureRoot()
  return { store, cwd }
}

describe('SpecStore.applyQuestionAnswers', () => {
  it('appends a new 用户批注 section with structured answer + freeform block', async () => {
    const { store } = await makeStore()
    const { id, path } = await store.create({
      title: 'X',
      type: 'feat',
      summary: 'x',
    })
    await store.applyQuestionAnswers(id, {
      answers: [
        {
          questionId: 'q-0',
          questionText: '候选答案的展现形式应采用哪种？',
          selectedOptionLabel: '表格',
          note: '保留候选项 (推荐) 后缀',
        },
      ],
      freeformAnnotations: [
        { sectionPath: '3. 现状分析', quote: 'GUI 现有批注链路', note: '补充 SSE 重连' },
      ],
    })
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('## 用户批注')
    expect(raw).toContain('> 待确认问题："候选答案的展现形式应采用哪种？"')
    expect(raw).toContain('> ！！！选择：表格；备注：保留候选项 (推荐) 后缀')
    expect(raw).toContain('> 3. 现状分析 中 "GUI 现有批注链路"')
    expect(raw).toContain('> ！！！补充 SSE 重连')
    const headerLines = raw.split('---')[1].trim().split('\n')
    expect(headerLines[0]).toBe('stage: plan')
    expect(headerLines[1]).toBe('last_action: 用户批量答复待确认问题')
    expect(headerLines[2]).toMatch(/^updated_at: '2026-06-18 \d{2}:\d{2}:\d{2}'$/)
  })

  it('merges into existing 用户批注 section instead of creating a duplicate heading', async () => {
    const { store } = await makeStore()
    const { id, path } = await store.create({
      title: 'X',
      type: 'feat',
      summary: 'x',
    })
    await store.applyQuestionAnswers(id, {
      answers: [{ questionText: 'Q1', selectedOptionLabel: 'A' }],
      freeformAnnotations: [],
    })
    await store.applyQuestionAnswers(id, {
      answers: [{ questionText: 'Q2', selectedOptionLabel: 'B' }],
      freeformAnnotations: [],
    })
    const raw = await readFile(path, 'utf8')
    const occurrences = raw.match(/^##\s+用户批注\s*$/gm) ?? []
    expect(occurrences).toHaveLength(1)
    expect(raw).toContain('> 待确认问题："Q1"')
    expect(raw).toContain('> 待确认问题："Q2"')
  })

  it('throws when both answers and freeformAnnotations are empty', async () => {
    const { store } = await makeStore()
    const { id } = await store.create({ title: 'X', type: 'feat', summary: 'x' })
    await expect(
      store.applyQuestionAnswers(id, { answers: [], freeformAnnotations: [] }),
    ).rejects.toThrow(/required/)
  })

  it('throws when spec not found', async () => {
    const { store } = await makeStore()
    await expect(
      store.applyQuestionAnswers('no-such', {
        answers: [{ questionText: 'Q', selectedOptionLabel: 'A' }],
        freeformAnnotations: [],
      }),
    ).rejects.toThrow(/spec not found/)
  })

  it('preserves answer with only a note (freeform-style question)', async () => {
    const { store } = await makeStore()
    const { id, path } = await store.create({ title: 'X', type: 'feat', summary: 'x' })
    await store.applyQuestionAnswers(id, {
      answers: [{ questionText: 'release notes 文案该怎么写？', note: '复用 PR 描述' }],
      freeformAnnotations: [],
    })
    const raw = await readFile(path, 'utf8')
    expect(raw).toContain('> ！！！备注：复用 PR 描述')
  })
})
