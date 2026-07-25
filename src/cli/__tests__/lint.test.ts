import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..', '..')
const CLI = resolve(ROOT, 'dist', 'cli', 'index.js')

const GOOD_SPEC = [
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
  '- [ ] 新建 A',
  '',
  '## 7. 追加任务',
  '',
  '- 暂无',
  '',
  '## 8. 执行记录',
  '',
].join('\n')

const BAD_SPEC = [
  '---',
  'stage: plan',
  'last_action: init',
  "updated_at: '2026-07-01 12:00:00'",
  'summary: s',
  '---',
  '',
  '## 1. 背景',
  '',
  '## 2. 需求',
  '',
].join('\n')

describe('yorz lint CLI', () => {
  beforeAll(() => {
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const result = spawnSync(pnpm, ['run', 'build:cli'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(
        [
          `Failed to build CLI before lint CLI tests (exit ${result.status}).`,
          result.error?.message,
          result.stdout,
          result.stderr,
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
  }, 30_000)

  it('exits 0 with clean JSON when spec is good', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yorz-lint-'))
    const specPath = join(dir, 'spec.md')
    writeFileSync(specPath, GOOD_SPEC, 'utf8')
    const result = spawnSync(
      'node',
      [CLI, 'lint', specPath, '--format', 'json', '--skip-mermaid-parse'],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.errorCount).toBe(0)
    expect(Array.isArray(parsed.reports)).toBe(true)
  })

  it('exits 1 with structured findings on bad spec', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yorz-lint-'))
    const specPath = join(dir, 'spec.md')
    writeFileSync(specPath, BAD_SPEC, 'utf8')
    const result = spawnSync(
      'node',
      [CLI, 'lint', specPath, '--format', 'json', '--skip-mermaid-parse'],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.errorCount).toBeGreaterThan(0)
    expect(parsed.reports[0].findings.length).toBeGreaterThan(0)
  })
})
