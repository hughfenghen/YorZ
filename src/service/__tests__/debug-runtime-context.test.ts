import { describe, expect, it } from 'vitest'
import { buildDebugPrompt, formatDebugRuntimeContext } from '../routes/specs.js'
import type { CommandRun } from '../command-types.js'

function run(overrides: Partial<CommandRun>): CommandRun {
  return {
    runId: 'run-1',
    commandId: 'cmd-1',
    name: 'dev',
    cli: 'pnpm dev',
    pid: 1234,
    status: 'running',
    startedAt: Date.UTC(2026, 7, 1, 3, 4, 5),
    logFile: '.yorz/tmp/commands/run-1.log',
    ...overrides,
  }
}

describe('debug runtime context', () => {
  it('formats running command runs with log paths for the debug prompt', () => {
    const text = formatDebugRuntimeContext([
      run({ runId: 'running-1', logFile: '.yorz/tmp/commands/running-1.log' }),
      run({
        runId: 'old-1',
        status: 'exited',
        endedAt: Date.UTC(2026, 7, 1, 3, 5, 5),
        exitCode: 0,
        logFile: '.yorz/tmp/commands/old-1.log',
      }),
    ])

    expect(text).toContain('当前项目运行服务上下文')
    expect(text).toContain('runId: running-1')
    expect(text).toContain('logFile: .yorz/tmp/commands/running-1.log')
    expect(text).toContain('调试要求：优先读取上述 logFile')
    expect(text).not.toContain('old-1')
  })

  it('formats an explicit empty context when no command is running', () => {
    const text = formatDebugRuntimeContext([run({ status: 'killed', signal: 'SIGTERM' })])

    expect(text).toContain('暂无运行中的命令服务')
  })

  it('appends runtime context to new and resume debug prompts', () => {
    const context = formatDebugRuntimeContext([
      run({ runId: 'run-ctx', logFile: '.yorz/tmp/commands/run-ctx.log' }),
    ])

    expect(buildDebugPrompt('.yorz/specs', '260801.feat.x', 'new', context)).toContain(
      '.yorz/tmp/commands/run-ctx.log',
    )
    expect(buildDebugPrompt('.yorz/specs', '260801.feat.x', 'resume', context)).toContain(
      '.yorz/tmp/commands/run-ctx.log',
    )
  })
})
