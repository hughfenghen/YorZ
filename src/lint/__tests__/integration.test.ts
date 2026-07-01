import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintFile } from '../index.js'

const REPO_ROOT = resolve(__dirname, '..', '..', '..')

describe('integration: real specs', () => {
  it('current spec (spec-md-content-lint) passes with 0 errors', async () => {
    const path = resolve(
      REPO_ROOT,
      '.yorz/specs/260701.feat.spec-md-content-lint/spec.md',
    )
    const report = await lintFile(path, { skipMermaidParse: true })
    expect(report.errorCount).toBe(0)
  })

  it('agent-panel-collapse-persist spec reports heading/section-level errors', async () => {
    const path = resolve(
      REPO_ROOT,
      '.yorz/specs/260701.feat.agent-panel-collapse-persist/spec.md',
    )
    const raw = await readFile(path, 'utf8').catch(() => '')
    if (!raw) return // fixture not present in CI
    const report = await lintFile(path, { skipMermaidParse: true })
    expect(report.errorCount).toBeGreaterThan(0)
    expect(report.findings.some((f) => f.ruleId === 'heading/section-level')).toBe(true)
  })

  it('body-scrollbar-overflow spec reports missing H1', async () => {
    const path = resolve(
      REPO_ROOT,
      '.yorz/specs/260701.fix.body-scrollbar-overflow/spec.md',
    )
    const raw = await readFile(path, 'utf8').catch(() => '')
    if (!raw) return
    const report = await lintFile(path, { skipMermaidParse: true })
    expect(
      report.findings.some(
        (f) => f.ruleId === 'heading/h1-single' && f.message.includes('缺少'),
      ),
    ).toBe(true)
  })
})
