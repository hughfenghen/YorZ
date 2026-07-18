import { describe, it, expect, vi } from 'vitest'
import { parseConfirmQuestions } from '../question-parse.js'

describe('parseConfirmQuestions', () => {
  it('returns [] when section is missing', () => {
    expect(parseConfirmQuestions('# 标题\n\n正文')).toEqual([])
  })

  it('returns [] for `_暂无_` empty-state paragraph', () => {
    const body = `## 5. 待确认问题\n\n_暂无_\n`
    expect(parseConfirmQuestions(body)).toEqual([])
  })

  it('returns [] when the section is empty', () => {
    const body = `## 5. 待确认问题\n\n## 6. 任务清单\n`
    expect(parseConfirmQuestions(body)).toEqual([])
  })

  it('parses a single question with a recommended option', () => {
    const body = `## 待确认问题\n\n### 5.1 用什么数据库？\n1. SQLite (推荐)\n`
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
      '### 5.1 候选答案的展现形式应采用哪种？',
      '1. 嵌套子列表',
      '2. 表格 (推荐)',
      '3. 自定义 YAML 块',
      '',
    ].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('候选答案的展现形式应采用哪种？')
    expect(out[0].options.map((o) => o.label)).toEqual(['嵌套子列表', '表格', '自定义 YAML 块'])
    expect(out[0].options.map((o) => o.recommended)).toEqual([false, true, false])
  })

  it('accepts full-width `（推荐）` as the recommendation marker', () => {
    const body = [
      '## 5. 待确认问题',
      '',
      '### 5.1 用什么数据库？',
      '1. SQLite （推荐）',
      '2. Postgres',
      '',
    ].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].options.map((o) => ({ label: o.label, recommended: o.recommended }))).toEqual([
      { label: 'SQLite', recommended: true },
      { label: 'Postgres', recommended: false },
    ])
  })

  it('treats a question without candidates as freeform', () => {
    const body = `## 待确认问题\n\n### 5.1 release notes 文案该怎么写？\n`
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].isFreeform).toBe(true)
    expect(out[0].options).toEqual([])
  })

  it('strips the numeric heading prefix from the question text', () => {
    const body = ['## 5. 待确认问题', '', '### 5.3 有跳号的问题？', '1. 是 (推荐)', ''].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('有跳号的问题？')
  })

  it('tolerates numbering gaps and preserves document order', () => {
    const body = [
      '## 5. 待确认问题',
      '',
      '### 5.1 问题 A',
      '1. 选项 1 (推荐)',
      '',
      '### 5.3 问题 B',
      '',
    ].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out.map((q) => q.text)).toEqual(['问题 A', '问题 B'])
    expect(out[1].isFreeform).toBe(true)
  })

  it('stops at the next `## ` heading', () => {
    const body = [
      '## 5. 待确认问题',
      '',
      '### 5.1 问题 A',
      '1. 选项 1 (推荐)',
      '',
      '### 5.2 问题 B',
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
    const body = `## 待确认问题\n\n### 5.1 同一文本\n### 5.2 同一文本\n`
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(2)
    expect(out[0].id).not.toBe(out[1].id)
  })

  it('treats a question with `（自由文本）` suffix as freeform and strips the suffix', () => {
    const body = `## 待确认问题\n\n### 5.1 release notes 文案该怎么写？（自由文本）\n1. 这条候选不应阻止 freeform 退化\n`
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('release notes 文案该怎么写？')
    expect(out[0].isFreeform).toBe(true)
  })

  it('keeps candidates even when a blank line separates the heading from the ordered list', () => {
    const body = [
      '## 待确认问题',
      '',
      '### 5.1 问题',
      '',
      '1. 候选 A',
      '2. 候选 B (推荐)',
      '',
    ].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].options).toHaveLength(2)
    expect(out[0].options.map((o) => o.label)).toEqual(['候选 A', '候选 B'])
    expect(out[0].options.map((o) => o.recommended)).toEqual([false, true])
    expect(out[0].isFreeform).toBe(false)
  })

  it('tolerates multiple blank lines between candidates', () => {
    const body = [
      '## 待确认问题',
      '',
      '### 5.1 问题',
      '',
      '',
      '1. 候选 A',
      '',
      '2. 候选 B',
      '',
    ].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].options.map((o) => o.label)).toEqual(['候选 A', '候选 B'])
    expect(out[0].isFreeform).toBe(false)
  })

  it('keeps only the first `(推荐)` when multiple are declared', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const body = [
      '## 待确认问题',
      '',
      '### 5.1 用什么数据库？',
      '1. SQLite (推荐)',
      '2. Postgres （推荐）',
      '3. MySQL',
      '',
    ].join('\n')
    try {
      const out = parseConfirmQuestions(body)
      expect(out).toHaveLength(1)
      expect(out[0].options.map((o) => ({ label: o.label, recommended: o.recommended }))).toEqual([
        { label: 'SQLite', recommended: true },
        { label: 'Postgres', recommended: false },
        { label: 'MySQL', recommended: false },
      ])
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('parses the new `待确认项` heading name', () => {
    const body = `## 5. 待确认项\n\n### 5.1 用什么数据库？\n1. SQLite (推荐)\n`
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('choice')
    expect(out[0].text).toBe('用什么数据库？')
  })

  it('tags an unmarked question with candidates as choice', () => {
    const body = `## 待确认项\n\n### 5.1 用什么数据库？\n1. SQLite (推荐)\n2. Postgres\n`
    const out = parseConfirmQuestions(body)
    expect(out[0].kind).toBe('choice')
  })

  it('parses a `[choice]` marker and strips it from the text', () => {
    const body = `## 待确认项\n\n### 5.1 [choice] 用什么数据库？\n1. SQLite (推荐)\n2. Postgres\n`
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('choice')
    expect(out[0].text).toBe('用什么数据库？')
    expect(out[0].options.map((o) => o.label)).toEqual(['SQLite', 'Postgres'])
  })

  it('parses a `[confirm]` item with 方案/影响 fields and no options', () => {
    const body = [
      '## 待确认项',
      '',
      '### 5.1 [confirm] 将 UserID 从 int 迁移为 uuid',
      '',
      '**方案**：一次性迁移，双写过渡 2 周。',
      '**影响**：🔴 需停机窗口；对外 API 字段类型变更。',
      '',
    ].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('confirm')
    expect(out[0].isFreeform).toBe(false)
    expect(out[0].options).toEqual([])
    expect(out[0].text).toBe('将 UserID 从 int 迁移为 uuid')
    expect(out[0].plan).toBe('一次性迁移，双写过渡 2 周。')
    expect(out[0].impact).toBe('🔴 需停机窗口；对外 API 字段类型变更。')
  })

  it('accepts `**代价**` as an alias for the confirm impact field', () => {
    const body = [
      '## 待确认项',
      '',
      '### 5.1 [confirm] 引入新依赖',
      '**方案**：引入 zod。',
      '**代价**：包体积 +20KB。',
      '',
    ].join('\n')
    const out = parseConfirmQuestions(body)
    expect(out[0].kind).toBe('confirm')
    expect(out[0].impact).toBe('包体积 +20KB。')
  })

  it('hard-switches away from the old bullet format (legacy input yields 0 questions)', () => {
    const body = [
      '## 5. 待确认问题',
      '',
      '- 旧格式问题',
      '  - 旧候选 A (推荐)',
      '  - 旧候选 B',
      '',
    ].join('\n')
    expect(parseConfirmQuestions(body)).toEqual([])
  })
})
