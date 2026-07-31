import { describe, expect, it } from 'vitest'
import { lintSpecMd } from '../spec-md-lint.js'

const OPTS = { skipMermaidParse: true }

describe('frontmatter/required-fields', () => {
  it('accepts a spec with all four fields in order', async () => {
    const raw = [
      '---',
      'stage: plan',
      'last_action: init',
      "updated_at: '2026-07-01 12:00:00'",
      'summary: valid summary',
      '---',
      '',
      '# T',
      '',
      '## 1. 背景',
      '',
      '## 2. 需求',
      '',
      '## 3. 现状分析',
      '',
      '## 4. 技术实现方案',
      '',
      '## 5. 待确认问题',
      '',
      '_暂无_',
      '',
      '## 6. 任务清单',
      '',
      '## 7. 追加任务',
      '',
      '- 暂无',
      '',
      '## 8. 执行记录',
      '',
    ].join('\n')
    const report = await lintSpecMd(raw, OPTS)
    const findings = report.findings.filter((f) => f.ruleId.startsWith('frontmatter/'))
    expect(findings).toEqual([])
  })

  it('accepts stage: done as a terminal state', async () => {
    const raw = [
      '---',
      'stage: done',
      'last_action: 任务全部完成，标记 done',
      "updated_at: '2026-07-05 12:00:00'",
      'summary: valid summary',
      '---',
      '',
      '# T',
      '',
    ].join('\n')
    const report = await lintSpecMd(raw, OPTS)
    const findings = report.findings.filter((f) => f.ruleId.startsWith('frontmatter/'))
    expect(findings).toEqual([])
  })

  it('flags an unknown stage value', async () => {
    const raw = [
      '---',
      'stage: shipped',
      'last_action: init',
      "updated_at: '2026-07-05 12:00:00'",
      'summary: s',
      '---',
      '',
      '# T',
      '',
    ].join('\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) =>
          f.ruleId === 'frontmatter/required-fields' &&
          f.message.includes('plan | tasks | execute | done'),
      ),
    ).toBe(true)
  })

  it('flags missing frontmatter', async () => {
    const raw = '# hello\n\n## 1. 背景\n'
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.map((f) => f.ruleId)).toContain('frontmatter/required-fields')
  })

  it('flags out-of-order fields', async () => {
    const raw = [
      '---',
      'last_action: init',
      'stage: plan',
      "updated_at: '2026-07-01 12:00:00'",
      'summary: s',
      '---',
      '',
      '# T',
      '',
    ].join('\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) => f.ruleId === 'frontmatter/required-fields' && f.message.includes('顺序应为'),
      ),
    ).toBe(true)
  })

  it('flags unknown extra fields', async () => {
    const raw = [
      '---',
      'stage: plan',
      'last_action: init',
      "updated_at: '2026-07-01 12:00:00'",
      'summary: s',
      'note: extra',
      '---',
      '',
      '# T',
      '',
    ].join('\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) => f.ruleId === 'frontmatter/required-fields' && f.message.includes('未知字段'),
      ),
    ).toBe(true)
  })
})

describe('frontmatter/updated-at', () => {
  it('accepts a double-quoted value', async () => {
    const raw = [
      '---',
      'stage: plan',
      'last_action: init',
      'updated_at: "2026-07-01 12:00:00"',
      'summary: s',
      '---',
      '',
      '# T',
      '',
    ].join('\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.filter((f) => f.ruleId === 'frontmatter/updated-at')).toEqual([])
  })

  it('flags a bare timestamp value', async () => {
    const raw = [
      '---',
      'stage: plan',
      'last_action: init',
      'updated_at: 2026-07-01 12:00:00',
      'summary: s',
      '---',
      '',
      '# T',
      '',
    ].join('\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) => f.ruleId === 'frontmatter/updated-at' && f.message.includes('YAML 字符串'),
      ),
    ).toBe(true)
  })

  it('flags a legacy YYYY-MM-DD only value', async () => {
    const raw = [
      '---',
      'stage: plan',
      'last_action: init',
      "updated_at: '2026-07-01'",
      'summary: s',
      '---',
      '',
      '# T',
      '',
    ].join('\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) => f.ruleId === 'frontmatter/updated-at' && f.message.includes('秒级'),
      ),
    ).toBe(true)
  })
})
