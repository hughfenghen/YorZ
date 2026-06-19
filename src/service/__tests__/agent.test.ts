import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentRunner, emitTouchedFromEvent, formatStreamEvent } from '../agent.js'

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.js', import.meta.url))
const FAKE_CLAUDE_JSONL = fileURLToPath(new URL('./fixtures/fake-claude-jsonl.js', import.meta.url))

function fakeResolver() {
  return () => ({
    cmd: process.execPath,
    args: (prompt: string) => [FAKE_CLAUDE, '-p', prompt],
    streamFormat: 'text' as const,
  })
}

function fakeJsonlResolver() {
  return () => ({
    cmd: process.execPath,
    args: (prompt: string) => [FAKE_CLAUDE_JSONL, '-p', prompt],
    streamFormat: 'json' as const,
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
        streamFormat: 'text' as const,
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
        streamFormat: 'text' as const,
      }),
    })
    const handle = runner.run({ specId: 's5', mode: 'explain', prompt: 'x' })
    const errors: string[] = []
    handle.onError((m) => errors.push(m))
    await handle.done
    expect(errors.length).toBeGreaterThan(0)
  })

  it('listActive returns [] when no runs are active', () => {
    const runner = new AgentRunner({ cwd: process.cwd(), resolveAgentCmd: fakeResolver() })
    expect(runner.listActive()).toEqual([])
  })

  it('parses stream-json output into formatted text chunks', async () => {
    const runner = new AgentRunner({ cwd: process.cwd(), resolveAgentCmd: fakeJsonlResolver() })
    const handle = runner.run({ specId: 's-jsonl', mode: 'explain', prompt: 'hi' })
    const chunks: string[] = []
    handle.onStdout((c) => chunks.push(c))
    const code = await handle.done
    expect(code).toBe(0)
    const combined = chunks.join('')
    // No raw JSON should leak through; the prompt text must be present.
    expect(combined).toContain('received prompt')
    expect(combined).toContain('hi')
    expect(combined).toContain('[system] init')
    expect(combined).toContain('[tool] echo(')
    expect(combined).toContain('[tool-result] echo ok')
    expect(combined).toContain('[result] success')
    expect(combined).not.toContain('"type":"assistant"')
  })

  it('cancel(runId) kills active run and clears handle within 2s', async () => {
    const runner = new AgentRunner({
      cwd: process.cwd(),
      resolveAgentCmd: () => ({
        cmd: process.execPath,
        args: () => ['-e', 'setInterval(()=>{}, 60000)'],
        streamFormat: 'text' as const,
      }),
    })
    const handle = runner.run({ specId: 's-cancel', mode: 'explain', prompt: 'x' })
    expect(runner.listActive()).toHaveLength(1)
    const ok = runner.cancel(handle.id)
    expect(ok).toBe(true)
    const start = Date.now()
    await handle.done
    expect(Date.now() - start).toBeLessThan(2000)
    expect(runner.listActive()).toEqual([])
  })

  it('cancel(runId) returns false for unknown id', () => {
    const runner = new AgentRunner({ cwd: process.cwd(), resolveAgentCmd: fakeResolver() })
    expect(runner.cancel('no-such-id')).toBe(false)
  })

  it('emitTouchedFromEvent emits relative POSIX path for Write / Edit tool_use', () => {
    const emitter = new EventEmitter()
    const seen: string[] = []
    emitter.on('file_touched', (p: string) => seen.push(p))
    const cwd = '/Users/x/proj'
    emitTouchedFromEvent(
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Write', input: { file_path: '/Users/x/proj/src/a.ts' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: 'src/b.ts' } },
            { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
            { type: 'text', text: 'ignored' },
          ],
        },
      },
      emitter,
      cwd,
    )
    expect(seen).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('emitTouchedFromEvent ignores non-assistant or malformed events', () => {
    const emitter = new EventEmitter()
    const seen: string[] = []
    emitter.on('file_touched', (p: string) => seen.push(p))
    emitTouchedFromEvent({ type: 'user', message: {} }, emitter, '/tmp')
    emitTouchedFromEvent({ type: 'assistant' }, emitter, '/tmp')
    emitTouchedFromEvent(
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Write', input: {} }] },
      },
      emitter,
      '/tmp',
    )
    expect(seen).toEqual([])
  })

  it('formatStreamEvent maps default event types to readable text', () => {
    expect(formatStreamEvent({ type: 'system', subtype: 'init' })).toBe('[system] init\n')
    expect(
      formatStreamEvent({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
    ).toBe('hello')
    expect(
      formatStreamEvent({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'read', input: { path: 'a' } }] },
      }),
    ).toContain('[tool] read(')
    expect(
      formatStreamEvent({
        type: 'user',
        message: { content: [{ type: 'tool_result', content: 'ok' }] },
      }),
    ).toBe('[tool-result] ok\n')
    expect(formatStreamEvent({ type: 'result', subtype: 'success' })).toBe('[result] success\n')
    expect(formatStreamEvent({ type: 'weird', x: 1 })).toContain('"type":"weird"')
  })

  it('listActive includes runId/mode/specId/startedAt for active runs and clears on exit', async () => {
    const runner = new AgentRunner({
      cwd: process.cwd(),
      resolveAgentCmd: () => ({
        cmd: process.execPath,
        args: () => ['-e', 'setInterval(()=>{}, 60000)'],
        streamFormat: 'text' as const,
      }),
    })
    const before = Date.now()
    const a = runner.run({ specId: 'spec-a', mode: 'skill-run', prompt: 'x' })
    const b = runner.run({ specId: 'spec-b', mode: 'explain', prompt: 'y' })
    const active = runner.listActive()
    expect(active).toHaveLength(2)
    const byId = Object.fromEntries(active.map((r) => [r.runId, r]))
    expect(byId[a.id]).toMatchObject({ mode: 'skill-run', specId: 'spec-a' })
    expect(byId[b.id]).toMatchObject({ mode: 'explain', specId: 'spec-b' })
    expect(byId[a.id].startedAt).toBeGreaterThanOrEqual(before)
    a.kill()
    b.kill()
    await Promise.all([a.done, b.done])
    expect(runner.listActive()).toEqual([])
  })
})

// Reference to silence unused-import warnings when test runner strips dirname.
void dirname
void join
