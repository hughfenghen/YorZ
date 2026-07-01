import { describe, expect, it } from 'vitest'
import { lintSpecMd } from '../spec-md-lint.js'

const OPTS = { skipMermaidParse: true }

function wrap(pending: string): string {
  return [
    '---',
    'stage: plan',
    'last_action: init',
    "updated_at: '2026-07-01 12:00:00'",
    'summary: s',
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
    pending,
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
}

describe('pending-questions/structure', () => {
  it('accepts ordered candidates with exactly one recommendation', async () => {
    const raw = wrap(
      ['### 5.1 应该采用哪种方案？', '', '1. 方案 A', '2. 方案 B (推荐)', '3. 方案 C'].join('\n'),
    )
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'pending-questions/structure')).toBe(false)
  })

  it('accepts freeform question with （自由文本） suffix', async () => {
    const raw = wrap('### 5.1 请补充说明。（自由文本）\n')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'pending-questions/structure')).toBe(false)
  })

  it('flags missing recommendation', async () => {
    const raw = wrap(
      ['### 5.1 应该采用哪种方案？', '', '1. 方案 A', '2. 方案 B', '3. 方案 C'].join('\n'),
    )
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) => f.ruleId === 'pending-questions/structure' && f.message.includes('推荐'),
      ),
    ).toBe(true)
  })

  it('flags multiple recommendations', async () => {
    const raw = wrap(
      ['### 5.1 应该采用哪种方案？', '', '1. 方案 A (推荐)', '2. 方案 B (推荐)'].join('\n'),
    )
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) => f.ruleId === 'pending-questions/structure' && f.message.includes('2 个'),
      ),
    ).toBe(true)
  })

  it('flags unordered - list candidates', async () => {
    const raw = wrap(
      ['### 5.1 应该采用哪种方案？', '', '- 方案 A', '- 方案 B (推荐)'].join('\n'),
    )
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) => f.ruleId === 'pending-questions/structure' && f.message.includes('无序'),
      ),
    ).toBe(true)
  })
})

describe('pending-questions/empty', () => {
  it('accepts _暂无_ italic placeholder', async () => {
    const raw = wrap('_暂无_')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'pending-questions/empty')).toBe(false)
  })

  it('flags `- 暂无` list variant', async () => {
    const raw = wrap('- 暂无')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'pending-questions/empty')).toBe(true)
  })
})

describe('pending-questions/no-named-recommend', () => {
  it('flags a "推荐：<name>" pseudo-candidate', async () => {
    const raw = wrap(
      ['### 5.1 应该采用哪种方案？', '', '1. 方案 A', '2. 方案 B (推荐)', '3. 推荐：方案 B'].join(
        '\n',
      ),
    )
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'pending-questions/no-named-recommend')).toBe(
      true,
    )
  })
})
