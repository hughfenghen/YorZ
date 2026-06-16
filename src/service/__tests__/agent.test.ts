import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentRunner } from '../agent.js'

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.js', import.meta.url))

function fakeResolver() {
  return () => ({
    cmd: process.execPath,
    args: (prompt: string) => [FAKE_CLAUDE, '-p', prompt],
  })
}

describe('AgentRunner', () => {
  it('spawns and streams stdout chunks then exits 0', async () => {
    const runner = new AgentRunner({ cwd: process.cwd(), resolveAgentCmd: fakeResolver() })
    const handle = runner.run({ specId: 's1', mode: 'explain', prompt: 'hello' })
    const chunks: string[] = []
    handle.onStdout((c) => chunks.push(c))
    const code = await handle.done
    expect(code).toBe(0)
    expect(chunks.join('')).toContain('received prompt')
    expect(chunks.join('')).toContain('hello')
    expect(handle.buffer()).toContain('done')
  })

  it('reuses the existing skill-run handle for the same spec', async () => {
    const runner = new AgentRunner({ cwd: process.cwd(), resolveAgentCmd: fakeResolver() })
    const a = runner.run({ specId: 's2', mode: 'skill-run', prompt: 'x' })
    const b = runner.run({ specId: 's2', mode: 'skill-run', prompt: 'y' })
    expect(b.id).toBe(a.id)
    await a.done
  })

  it('does not collapse explain runs for the same spec', async () => {
    const runner = new AgentRunner({ cwd: process.cwd(), resolveAgentCmd: fakeResolver() })
    const a = runner.run({ specId: 's3', mode: 'explain', prompt: '1' })
    const b = runner.run({ specId: 's3', mode: 'explain', prompt: '2' })
    expect(b.id).not.toBe(a.id)
    await Promise.all([a.done, b.done])
  })

  it('kills the process when kill() is called', async () => {
    const runner = new AgentRunner({
      cwd: process.cwd(),
      resolveAgentCmd: () => ({
        cmd: process.execPath,
        // a node process that waits forever
        args: () => ['-e', 'setInterval(()=>{}, 60000)'],
      }),
    })
    const handle = runner.run({ specId: 's4', mode: 'explain', prompt: 'wait' })
    setTimeout(() => handle.kill(), 30)
    const code = await handle.done
    // killed by SIGTERM: code is null on Node when signal terminates
    expect(code === null || typeof code === 'number').toBe(true)
  })

  it('emits error when the spawned command does not exist', async () => {
    const runner = new AgentRunner({
      cwd: process.cwd(),
      resolveAgentCmd: () => ({
        cmd: '/no/such/binary-yorz-test',
        args: () => [],
      }),
    })
    const handle = runner.run({ specId: 's5', mode: 'explain', prompt: 'x' })
    const errors: string[] = []
    handle.onError((m) => errors.push(m))
    await handle.done
    expect(errors.length).toBeGreaterThan(0)
  })
})

// Reference to silence unused-import warnings when test runner strips dirname.
void dirname
void join
