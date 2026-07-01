import { describe, expect, it } from 'vitest'
import { lintSpecMd } from '../spec-md-lint.js'

const OPTS_SKIP = { skipMermaidParse: true }

function wrap(mermaidBlock: string): string {
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
    mermaidBlock,
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
}

describe('mermaid/fence', () => {
  it('accepts a flowchart', async () => {
    const raw = wrap('```mermaid\nflowchart LR\n  A --> B\n```')
    const report = await lintSpecMd(raw, OPTS_SKIP)
    expect(report.findings.some((f) => f.ruleId === 'mermaid/fence')).toBe(false)
  })

  it('flags an unknown diagram type', async () => {
    const raw = wrap('```mermaid\nnotADiagram X\n  A --> B\n```')
    const report = await lintSpecMd(raw, OPTS_SKIP)
    expect(report.findings.some((f) => f.ruleId === 'mermaid/fence')).toBe(true)
  })
})
