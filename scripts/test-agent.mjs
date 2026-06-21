#!/usr/bin/env node
import { spawn } from 'node:child_process'

const passthrough = []
let agent = process.env.YORZ_TEST_AGENT
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--agent(?:=(.+))?$/)
  if (m) {
    if (m[1]) agent = m[1]
    continue
  }
  passthrough.push(arg)
}

const env = { ...process.env }
if (agent) env.YORZ_TEST_AGENT = agent

const child = spawn(
  'vitest',
  ['run', '--config', 'src/skill/yorz-spec/__tests__/vitest.config.ts', ...passthrough],
  { stdio: 'inherit', env, shell: false },
)
child.on('exit', (code) => process.exit(code ?? 1))
