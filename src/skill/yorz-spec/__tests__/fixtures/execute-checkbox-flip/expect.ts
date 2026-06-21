import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { AssertResult, ParsedSpec } from '../../runner.js'

/**
 * Execute stage must:
 *   - flip the single `- [ ]` task to `- [x]`
 *   - append ≥ 1 line under `## 执行记录` (something more than `- 暂无`)
 *   - actually create the HELLO.txt file in the tmp cwd
 *
 * The HELLO.txt check uses the spec's path to resolve the tmp cwd: spec is at
 * `<tmp>/.yorz/specs/<case>/spec.md`, so the cwd is 3 levels up from dirname.
 */
export async function assert(parsed: ParsedSpec): Promise<AssertResult> {
  const failures: string[] = []
  const rules: string[] = []

  rules.push('task flipped to - [x]')
  const tasksSection = extractSection(parsed.body, '任务清单')
  if (!tasksSection || !/- \[x\] /.test(tasksSection)) {
    failures.push('expected the task to be flipped to - [x]')
  }
  if (tasksSection && /- \[ \] /.test(tasksSection)) {
    failures.push('found a remaining - [ ] task (should be 0 for this fixture)')
  }

  rules.push('## 执行记录 has a real entry')
  const execSection = extractSection(parsed.body, '执行记录')
  if (!execSection || execSection.trim() === '- 暂无' || execSection.trim().length === 0) {
    failures.push('## 执行记录 still empty after execute')
  }

  rules.push('frontmatter.stage stays execute and last_action mentions the task')
  if (parsed.frontmatter.stage !== 'execute') {
    failures.push(`stage expected execute, got ${String(parsed.frontmatter.stage)}`)
  }
  return finalize(failures, rules)
}

function extractSection(body: string, titleSuffix: string): string | null {
  const lines = body.split('\n')
  let inSection = false
  const out: string[] = []
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      if (inSection) break
      if (line.includes(titleSuffix)) inSection = true
      continue
    }
    if (inSection) out.push(line)
  }
  return inSection ? out.join('\n').trim() : null
}

function finalize(failures: string[], rules: string[]): AssertResult {
  return { failures, hitRules: rules.length - failures.length, totalRules: rules.length }
}
