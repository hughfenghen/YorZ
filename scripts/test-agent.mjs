#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

// 通过当前 Node 直接运行 Vitest 的真实入口，避免 Windows 无法执行 vitest.cmd shim。
const vitestEntry = fileURLToPath(import.meta.resolve('vitest/vitest.mjs'))
const child = spawn(
  process.execPath,
  [
    vitestEntry,
    'run',
    '--config',
    'src/skill/yorz-spec/__tests__/vitest.config.ts',
    ...passthrough,
  ],
  {
    stdio: 'inherit',
    env,
    shell: false,
    // 仅 Windows 使用该选项；其他平台的 Node.js 会忽略它并保持原有 stdio 行为。
    windowsHide: process.platform === 'win32',
  },
)
child.on('error', (err) => {
  console.error(`[test:agent] failed to start Vitest: ${err.message}`)
  process.exitCode = 1
})
child.on('exit', (code) => process.exit(code ?? 1))
