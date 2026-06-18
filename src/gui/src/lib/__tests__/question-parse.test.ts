import { describe, it, expect } from 'vitest'
import { parseConfirmQuestions } from '../question-parse.js'

describe('parseConfirmQuestions', () => {
  it('returns [] when section is missing', () => {
    expect(parseConfirmQuestions('# 标题\n\n正文')).toEqual([])
  })

  it('returns [] for `- 暂无`', () => {
    const body = `## 5. 待确认问题\n\n- 暂无\n`
    expect(parseConfirmQuestions(body)).toEqual([])
  })

  it('parses a single question with a recommended option', () => {
    const body = `## 待确认问题\n\n- 用什么数据库？\n  - SQLite (推荐)\n`
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('用什么数据库？')
    expect(out[0].isFreeform).toBe(false)
    expect(out[0].options).toEqual([{ id: expect.any(String), label: 'SQLite', recommended: true }])
  })

  it('parses multiple options with exactly one recommendation', () => {
    const body = [
      '## 5. 待确认问题',
      '',
      '- 候选答案的展现形式应采用哪种？',
      '  - 嵌套子列表',
      '  - 表格 (推荐)',
      '  - 自定义 YAML 块',
      '',
    ].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].options.map((o) => o.label)).toEqual(['嵌套子列表', '表格', '自定义 YAML 块'])
    expect(out[0].options.map((o) => o.recommended)).toEqual([false, true, false])
  })

  it('treats a question without sub-bullets as freeform', () => {
    const body = `## 待确认问题\n\n- release notes 文案该怎么写？\n`
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].isFreeform).toBe(true)
    expect(out[0].options).toEqual([])
  })

  it('stops at the next heading and supports numbered headings', () => {
    const body = [
      '## 5. 待确认问题',
      '',
      '- 问题 A',
      '  - 选项 1 (推荐)',
      '',
      '- 问题 B',
      '',
      '## 6. 任务清单',
      '',
      '- [ ] something',
    ].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out.map((q) => q.text)).toEqual(['问题 A', '问题 B'])
    expect(out[1].isFreeform).toBe(true)
  })

  it('generates stable ids derived from text + index', () => {
    const body = `## 待确认问题\n\n- 同一文本\n- 同一文本\n`
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(2)
    expect(out[0].id).not.toBe(out[1].id)
  })
})
