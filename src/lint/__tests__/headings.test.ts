import { describe, expect, it } from 'vitest'
import { lintSpecMd } from '../spec-md-lint.js'

const OPTS = { skipMermaidParse: true }

function buildSpec(body: string): string {
  return [
    '---',
    'stage: plan',
    'last_action: init',
    "updated_at: '2026-07-01 12:00:00'",
    'summary: s',
    '---',
    '',
    body,
    '',
  ].join('\n')
}

describe('heading/h1-single', () => {
  it('passes when body has exactly one H1', async () => {
    const raw = buildSpec(
      [
        '# hello',
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
      ].join('\n'),
    )
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'heading/h1-single')).toBe(false)
  })

  it('flags missing H1', async () => {
    const raw = buildSpec('## 1. 背景\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'heading/h1-single')).toBe(true)
  })

  it('flags multiple H1s', async () => {
    const raw = buildSpec('# T\n\n# X\n\n## 1. 背景')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.filter((f) => f.ruleId === 'heading/h1-single').length).toBeGreaterThan(0)
  })
})

describe('heading/section-level', () => {
  it('flags a required section written as H1', async () => {
    const raw = buildSpec('# T\n\n# 背景\n\n## 2. 需求')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'heading/section-level')).toBe(true)
  })
})

describe('heading/numbering', () => {
  it('flags missing numbering on H2', async () => {
    const raw = buildSpec('# T\n\n## 背景\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'heading/numbering')).toBe(true)
  })

  it('flags out-of-order numbering', async () => {
    const raw = buildSpec('# T\n\n## 1. 背景\n\n## 3. 需求\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'heading/numbering')).toBe(true)
  })
})
