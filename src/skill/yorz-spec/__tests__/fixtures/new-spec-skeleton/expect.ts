import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import matter from 'gray-matter'
import type { AssertResult, ParsedSpec } from '../../runner.js'

/**
 * New-spec scenario: runner does NOT pre-seed a spec. We assert that the agent
 * created `.yorz/specs/<id>/spec.md` with `<id>` matching `YYMMDD.<type>.<slug>`.
 *
 * Because the runner reads `parsed` from `specRelPath` which is the default
 * `.yorz/specs/<caseName>/spec.md`, the agent's output won't land there — so
 * we re-scan the tmp cwd ourselves via the raw spec path embedded in `parsed`.
 * The runner exposes nothing for that, so we work it out from `process.env` set
 * by the runner. Fallback: scan repoRoot/tmp/agent-test/new-spec-skeleton-<pid>.
 */
export async function assert(parsed: ParsedSpec): Promise<AssertResult> {
  const failures: string[] = []
  const rules: string[] = []

  // The runner places its tmpDir into process.env.YORZ_TEST_TMPDIR before calling
  // the assert (see runner.ts:runAgentCase). We grep that dir for the produced spec.
  const tmpDir = process.env.YORZ_TEST_TMPDIR
  rules.push('runner exposed tmpDir')
  if (!tmpDir || !existsSync(tmpDir)) {
    failures.push(`YORZ_TEST_TMPDIR not set or missing: ${tmpDir}`)
    return finalize(failures, rules)
  }

  const specsRoot = join(tmpDir, '.yorz/specs')
  rules.push('.yorz/specs directory created')
  if (!existsSync(specsRoot)) {
    failures.push(`agent did not create ${specsRoot}`)
    return finalize(failures, rules)
  }

  const ids = readdirSync(specsRoot).filter((n) => !n.startsWith('.'))
  rules.push('exactly one new spec subdirectory present')
  if (ids.length !== 1) {
    failures.push(`expected 1 spec dir, got ${ids.length}: ${ids.join(',')}`)
    return finalize(failures, rules)
  }

  const id = ids[0]!
  rules.push('spec id matches YYMMDD.<type>.<slug>')
  if (!/^\d{6}\.(feat|refct|fix)\.[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
    failures.push(`spec id "${id}" does not match YYMMDD.<type>.<slug>`)
  }

  const specPath = join(specsRoot, id, 'spec.md')
  rules.push('spec.md created at the expected path')
  if (!existsSync(specPath)) {
    failures.push(`spec.md missing at ${specPath}`)
    return finalize(failures, rules)
  }

  const raw = readFileSync(specPath, 'utf8')
  const m = matter(raw)
  const fm = m.data as Record<string, unknown>
  for (const key of ['stage', 'last_action', 'updated_at', 'summary']) {
    rules.push(`frontmatter has ${key}`)
    if (!fm[key]) failures.push(`frontmatter missing ${key}`)
  }

  for (const section of ['现状分析', '技术实现方案', '待确认问题', '任务清单', '执行记录']) {
    rules.push(`body has section ## ${section}`)
    // Conventions.md numbers H2 as `## N. 标题`; allow either numbered or bare form.
    const re = new RegExp(`^##\\s+(?:\\d+\\.\\s+)?${section}\\s*$`, 'm')
    if (!re.test(m.content)) failures.push(`body missing section ## ${section}`)
  }
  return finalize(failures, rules)
}

function finalize(failures: string[], rules: string[]): AssertResult {
  return { failures, hitRules: rules.length - failures.length, totalRules: rules.length }
}
