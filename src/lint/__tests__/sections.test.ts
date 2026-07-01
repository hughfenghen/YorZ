import { describe, expect, it } from 'vitest'
import { lintSpecMd } from '../spec-md-lint.js'

const OPTS = { skipMermaidParse: true }

function withSections(sections: string[]): string {
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
    ...sections,
    '',
  ].join('\n')
}

describe('sections/required', () => {
  it('passes when 追加任务 is absent (可选章节)', async () => {
    const raw = withSections([
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
      '## 7. 执行记录',
    ])
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'sections/required')).toBe(false)
  })

  it('passes when 追加任务 is present between 任务清单 and 执行记录', async () => {
    const raw = withSections([
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
    ])
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'sections/required')).toBe(false)
  })

  it('flags a missing required section (e.g. 执行记录)', async () => {
    const raw = withSections([
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
    ])
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) => f.ruleId === 'sections/required' && f.message.includes('执行记录'),
      ),
    ).toBe(true)
  })

  it('flags 追加任务 placed after 执行记录 (顺序违规)', async () => {
    const raw = withSections([
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
      '## 7. 执行记录',
      '',
      '## 8. 追加任务',
      '',
      '- 暂无',
    ])
    const report = await lintSpecMd(raw, OPTS)
    expect(
      report.findings.some(
        (f) => f.ruleId === 'sections/required' && f.message.includes('追加任务'),
      ),
    ).toBe(true)
  })
})
