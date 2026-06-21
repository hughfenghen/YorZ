import type { AssertResult, ParsedSpec } from '../../runner.js'

/**
 * 追加任务 [open] 应被 Agent 视为新输入：触发 plan 重开然后继续 execute。
 * 完成后 [open] 必须改为 [fixed]，且 ## 执行记录 至少多出 1 条记录。
 */
export async function assert(parsed: ParsedSpec): Promise<AssertResult> {
  const failures: string[] = []
  const rules: string[] = []

  const append = extractSection(parsed.body, '追加任务')
  rules.push('## 追加任务 section present')
  if (!append) {
    failures.push('## 追加任务 section missing')
    return finalize(failures, rules)
  }

  rules.push('[open] flipped to [fixed]')
  if (/\[open\]/.test(append)) {
    failures.push('still found `[open]` in 追加任务')
  }
  if (!/\[fixed\]/.test(append)) {
    failures.push('追加任务 contains no `[fixed]` entry after execute')
  }

  const exec = extractSection(parsed.body, '执行记录') ?? ''
  rules.push('## 执行记录 grew at least one new entry')
  const execLines = exec.split('\n').filter((l) => /^- /.test(l))
  if (execLines.length < 2) {
    failures.push(`expected ≥ 2 entries in 执行记录, got ${execLines.length}`)
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
