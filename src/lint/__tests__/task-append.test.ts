import { describe, expect, it } from 'vitest'
import { lintSpecMd } from '../spec-md-lint.js'

const OPTS = { skipMermaidParse: true }

function wrap(taskList: string, append: string): string {
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
    '_暂无_',
    '',
    '## 6. 任务清单',
    '',
    taskList,
    '',
    '## 7. 追加任务',
    '',
    append,
    '',
    '## 8. 执行记录',
    '',
  ].join('\n')
}

describe('task-list/format', () => {
  it('accepts flat `- [ ]` / `- [x]` items', async () => {
    const raw = wrap('- [ ] 新建 A\n- [x] 修改 B', '- 暂无')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'task-list/format')).toBe(false)
  })

  it('flags nested subitems', async () => {
    const raw = wrap('- [ ] 新建 A\n  - [ ] 子任务', '- 暂无')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'task-list/format')).toBe(true)
  })

  it('flags non-standard status markers', async () => {
    const raw = wrap('- [-] 半完成', '- 暂无')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'task-list/format')).toBe(true)
  })
})

describe('append-task/format', () => {
  it('accepts `- 暂无` placeholder', async () => {
    const raw = wrap('- [ ] 任务', '- 暂无')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'append-task/format')).toBe(false)
  })

  it('accepts a well-formed [open][feat] entry', async () => {
    const raw = wrap('- [ ] 任务', '- [open] [feat] 2026-07-01 12:00:00 | 支持 xxx')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'append-task/format')).toBe(false)
  })

  it('flags a malformed entry missing [feat|refct|fix]', async () => {
    const raw = wrap('- [ ] 任务', '- [open] 支持 xxx')
    const report = await lintSpecMd(raw, OPTS)
    expect(report.findings.some((f) => f.ruleId === 'append-task/format')).toBe(true)
  })
})
