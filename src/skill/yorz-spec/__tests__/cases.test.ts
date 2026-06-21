import { afterAll, describe, expect, it } from 'vitest'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runAgentCase,
  resolveTestAgent,
  writeReport,
  type AgentCaseResult,
} from './runner.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = resolve(here, 'fixtures')
const agent = resolveTestAgent()

const CASES = [
  'plan-candidates',
  'tasks-consume-annotations',
  'execute-checkbox-flip',
  'new-spec-skeleton',
  'reopen-on-new-requirement',
  'append-task-state',
]

const results: AgentCaseResult[] = []

describe(`yorz-spec real-agent cases (agent=${agent})`, () => {
  for (const name of CASES) {
    it(name, async () => {
      const r = await runAgentCase({
        caseDir: resolve(fixturesDir, name),
        agent,
        runId: `${name}-${process.pid}`,
      })
      results.push(r)
      // Surface the spec content on failure so the failing run is debuggable
      // without digging into tmp/agent-test/.
      expect(r.pass, formatFailure(r)).toBe(true)
    })
  }

  afterAll(async () => {
    if (results.length === 0) return
    await writeReport(results, agent)
  })
})

function formatFailure(r: AgentCaseResult): string {
  return [
    `case=${r.caseName} agent=${r.agent} hit=${r.hitRules}/${r.totalRules}`,
    ...r.failures.map((f) => `  · ${f}`),
    `tmp=${r.tmpDir}`,
  ].join('\n')
}
