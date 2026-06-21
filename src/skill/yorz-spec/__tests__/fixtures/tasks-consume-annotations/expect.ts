import type { AssertResult, ParsedSpec } from '../../runner.js'

/**
 * After consuming `！！！` annotations the agent must:
 *   - remove every `！！！` token from the body
 *   - emit a single-level `- [ ]` task list (≥ 1 item) under `## 任务清单`
 *   - move stage to either `tasks` or `execute`
 */
export async function assert(parsed: ParsedSpec): Promise<AssertResult> {
  const failures: string[] = []
  const rules: string[] = []

  rules.push('all ！！！ annotations consumed')
  if (parsed.body.includes('！！！')) {
    failures.push('found leftover ！！！ in body')
  }

  rules.push('stage advanced past plan')
  if (parsed.frontmatter.stage === 'plan') {
    failures.push(`stage still plan after consuming annotations`)
  }

  rules.push('## 任务清单 has ≥ 1 single-level `- [ ]` task')
  const tasksSection = extractSection(parsed.body, '任务清单')
  if (!tasksSection) {
    failures.push('## 任务清单 section missing')
  } else {
    const taskLines = tasksSection.split('\n').filter((l) => /^- \[[ x]\] /.test(l))
    const nestedTasks = tasksSection.split('\n').filter((l) => /^\s{2,}- \[[ x]\] /.test(l))
    if (taskLines.length === 0) {
      failures.push('no `- [ ]` / `- [x]` tasks emitted')
    }
    if (nestedTasks.length > 0) {
      failures.push(`found ${nestedTasks.length} nested tasks (only single-level allowed)`)
    }
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
