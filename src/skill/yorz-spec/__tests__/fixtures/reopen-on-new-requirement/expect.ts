import type { AssertResult, ParsedSpec } from '../../runner.js'

/**
 * 输入的 spec 在 `## 需求` 内已经混入「新增需求」，且 stage=execute。Agent 应识别新增
 * 需求，把 stage 切回 plan，并在 last_action 中体现「重开」语义。
 */
export async function assert(parsed: ParsedSpec): Promise<AssertResult> {
  const failures: string[] = []
  const rules: string[] = []

  rules.push('frontmatter.stage rolled back to plan')
  if (parsed.frontmatter.stage !== 'plan') {
    failures.push(`stage expected plan after detecting 新增需求, got ${String(parsed.frontmatter.stage)}`)
  }

  rules.push('last_action mentions 重开 / 变更 / 新增需求')
  const la = String(parsed.frontmatter.last_action ?? '')
  if (!/重开|变更|新增|需求/.test(la)) {
    failures.push(`last_action does not signal reopen: "${la}"`)
  }

  rules.push('## 技术实现方案 acknowledges HELLO.md')
  const tech = extractSection(parsed.body, '技术实现方案')
  if (!tech || !tech.includes('HELLO.md')) {
    failures.push('技术实现方案 should be updated to cover HELLO.md sync')
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
