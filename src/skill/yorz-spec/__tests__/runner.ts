import { spawn } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import { resolveAgentCmd, type AgentName } from '../../../service/agent-config.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')
const skillSrcDir = resolve(here, '..')
const reportsDir = resolve(here, 'reports')

export interface ParsedSpec {
  raw: string
  frontmatter: Record<string, unknown>
  body: string
}

export interface AssertResult {
  failures: string[]
  hitRules: number
  totalRules: number
}

export type AssertFn = (parsed: ParsedSpec) => Promise<AssertResult> | AssertResult

export interface FixtureMeta {
  module?: string
  prompt?: string
  /** When set, the runner does NOT seed input.spec.md (new-spec scenario). */
  newSpec?: boolean
  /** Relative target path under cwd for the seeded spec (default: `.yorz/specs/case/spec.md`). */
  specRelPath?: string
}

export interface AgentCaseOptions {
  /** Absolute path to fixtures/<case>/. */
  caseDir: string
  /** Which builtin agent to spawn. Falls back to YORZ_TEST_AGENT env, then 'claude'. */
  agent?: AgentName
  /** Caller-supplied id used in the tmp dir name (typically the case name). */
  runId?: string
}

export interface AgentCaseResult {
  caseName: string
  agent: AgentName
  module?: string
  pass: boolean
  failures: string[]
  hitRules: number
  totalRules: number
  durationMs: number
  tmpDir: string
  specPath: string
  outputSpec: string
}

export function resolveTestAgent(explicit?: AgentName): AgentName {
  if (explicit) return explicit
  const fromEnv = process.env.YORZ_TEST_AGENT
  if (fromEnv === 'opencode' || fromEnv === 'claude') return fromEnv
  return 'claude'
}

async function loadFixtureMeta(caseDir: string): Promise<FixtureMeta> {
  const metaPath = join(caseDir, 'meta.json')
  if (!existsSync(metaPath)) return {}
  const raw = await readFile(metaPath, 'utf8')
  return JSON.parse(raw) as FixtureMeta
}

async function loadExpect(caseDir: string): Promise<AssertFn> {
  const expectPath = join(caseDir, 'expect.ts')
  const mod = (await import(pathToFileURL(expectPath).href)) as { assert?: AssertFn }
  if (typeof mod.assert !== 'function') {
    throw new Error(`fixture ${caseDir} missing exported assert()`)
  }
  return mod.assert
}

/**
 * Copy the entire src/skill/yorz-spec tree (sans __tests__) into the tmp project's
 * `.claude/skills/yorz-spec/`. Mirrors what `install.ts` writes to user scope.
 */
async function seedSkill(tmpDir: string): Promise<void> {
  const dest = join(tmpDir, '.claude/skills/yorz-spec')
  await mkdir(dest, { recursive: true })
  await cp(skillSrcDir, dest, {
    recursive: true,
    filter: (src) => !src.includes(`${skillSrcDir}/__tests__`),
  })
}

function spawnAgent(cmd: string, args: string[], cwd: string): Promise<{ code: number; spawnError?: Error }> {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' })
    let settled = false
    child.on('error', (err) => {
      if (settled) return
      settled = true
      resolveP({ code: -1, spawnError: err })
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      resolveP({ code: code ?? -1 })
    })
  })
}

export async function runAgentCase(opts: AgentCaseOptions): Promise<AgentCaseResult> {
  const start = Date.now()
  const caseName = basename(opts.caseDir)
  const agent = resolveTestAgent(opts.agent)
  const meta = await loadFixtureMeta(opts.caseDir)
  const assertFn = await loadExpect(opts.caseDir)

  const runId = opts.runId ?? `${caseName}-${process.pid}`
  const tmpDir = join(repoRoot, 'tmp', 'agent-test', runId)
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })
  await seedSkill(tmpDir)

  const specRelPath = meta.specRelPath ?? `.yorz/specs/${caseName}/spec.md`
  const specPath = join(tmpDir, specRelPath)
  let prompt: string
  if (meta.newSpec) {
    prompt = meta.prompt ?? '请使用 yorz-spec skill 新建 spec：YorZ 接入示例需求。'
  } else {
    await mkdir(dirname(specPath), { recursive: true })
    await cp(join(opts.caseDir, 'input.spec.md'), specPath)
    prompt = meta.prompt ?? `请使用 yorz-spec skill 处理 spec：${specRelPath}`
  }

  const cmd = resolveAgentCmd({ cwd: tmpDir, agent, env: process.env })
  const { code, spawnError } = await spawnAgent(cmd.cmd, cmd.args(prompt), tmpDir)

  let outputSpec = ''
  let parsedFrontmatter: Record<string, unknown> = {}
  let parsedBody = ''
  if (existsSync(specPath)) {
    outputSpec = await readFile(specPath, 'utf8')
    const parsed = matter(outputSpec)
    parsedFrontmatter = parsed.data as Record<string, unknown>
    parsedBody = parsed.content
  }

  let assertResult: AssertResult
  // Expose tmp paths to the assert via env so fixtures can inspect side-effect
  // files (e.g. new-spec scenario where the agent picks its own spec path).
  const prevTmp = process.env.YORZ_TEST_TMPDIR
  process.env.YORZ_TEST_TMPDIR = tmpDir
  try {
    if (spawnError) {
      assertResult = {
        failures: [`failed to spawn ${cmd.cmd}: ${spawnError.message}`],
        hitRules: 0,
        totalRules: 1,
      }
    } else if (code !== 0 && !outputSpec) {
      assertResult = {
        failures: [`agent exited with code ${code} and produced no spec.md`],
        hitRules: 0,
        totalRules: 1,
      }
    } else {
      assertResult = await assertFn({
        raw: outputSpec,
        frontmatter: parsedFrontmatter,
        body: parsedBody,
      })
    }
  } finally {
    if (prevTmp === undefined) delete process.env.YORZ_TEST_TMPDIR
    else process.env.YORZ_TEST_TMPDIR = prevTmp
  }

  return {
    caseName,
    agent,
    module: meta.module,
    pass: assertResult.failures.length === 0,
    failures: assertResult.failures,
    hitRules: assertResult.hitRules,
    totalRules: assertResult.totalRules,
    durationMs: Date.now() - start,
    tmpDir,
    specPath,
    outputSpec,
  }
}

/**
 * Convenience helper: parse a spec.md string the same way the runner does so
 * test cases can build small assertions without re-importing gray-matter.
 */
export function parseSpec(raw: string): ParsedSpec {
  const m = matter(raw)
  return { raw, frontmatter: m.data as Record<string, unknown>, body: m.content }
}

/** Walk `## N. Title` blocks. Returns body of the named section (matches by suffix). */
export function findSection(body: string, titleSuffix: string): string {
  const lines = body.split('\n')
  let inSection = false
  const out: string[] = []
  for (const line of lines) {
    const isH2 = /^##\s/.test(line)
    if (isH2) {
      if (inSection) break
      if (line.endsWith(titleSuffix) || line.includes(titleSuffix)) inSection = true
      continue
    }
    if (inSection) out.push(line)
  }
  return out.join('\n').trim()
}

export interface AggregatedReport {
  generatedAt: string
  agent: AgentName
  cases: AgentCaseResult[]
  byModule: Record<string, { total: number; passed: number; rate: number }>
  sectionCompleteness: Record<string, number>
  pass: boolean
}

const REQUIRED_SECTIONS = ['现状分析', '技术实现方案', '待确认问题', '任务清单', '执行记录']

export async function writeReport(results: AgentCaseResult[], agent: AgentName): Promise<string> {
  await mkdir(reportsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(reportsDir, `${stamp}-${agent}.json`)
  const byModule: AggregatedReport['byModule'] = {}
  for (const r of results) {
    const key = r.module ?? 'unknown'
    const slot = (byModule[key] ??= { total: 0, passed: 0, rate: 0 })
    slot.total += 1
    if (r.pass) slot.passed += 1
  }
  for (const slot of Object.values(byModule)) {
    slot.rate = slot.total === 0 ? 0 : slot.passed / slot.total
  }
  const sectionCompleteness: Record<string, number> = {}
  for (const section of REQUIRED_SECTIONS) {
    const present = results.filter((r) => r.outputSpec.includes(`## `) && r.outputSpec.includes(section)).length
    sectionCompleteness[section] = results.length === 0 ? 0 : present / results.length
  }
  const report: AggregatedReport = {
    generatedAt: stamp,
    agent,
    cases: results,
    byModule,
    sectionCompleteness,
    pass: results.every((r) => r.pass),
  }
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8')
  // Human-readable console table.
  // eslint-disable-next-line no-console
  console.log(`\n[test:agent] report: ${path}`)
  // eslint-disable-next-line no-console
  console.table(
    results.map((r) => ({
      case: r.caseName,
      module: r.module ?? '-',
      pass: r.pass ? 'PASS' : 'FAIL',
      hit: `${r.hitRules}/${r.totalRules}`,
      ms: r.durationMs,
    })),
  )
  return path
}
