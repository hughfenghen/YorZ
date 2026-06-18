import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAgentCmd } from '../agent-config.js'

async function tempCwd() {
  return mkdtemp(join(tmpdir(), 'yorz-agent-cfg-'))
}

async function writeConfig(cwd: string, agent: unknown) {
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  await writeFile(join(cwd, '.yorz', 'config.json'), JSON.stringify({ agent }), 'utf8')
}

describe('resolveAgentCmd', () => {
  it('defaults to claude when no config file present', async () => {
    const cwd = await tempCwd()
    const result = resolveAgentCmd({ cwd, env: {} })
    expect(result.cmd).toBe('claude')
    expect(result.args('hello')).toEqual([
      '--permission-mode',
      'bypassPermissions',
      '--output-format',
      'stream-json',
      '--verbose',
      '-p',
      'hello',
    ])
    expect(result.streamFormat).toBe('json')
  })

  it('picks claude when config sets agent=claude', async () => {
    const cwd = await tempCwd()
    await writeConfig(cwd, 'claude')
    const result = resolveAgentCmd({ cwd, env: {} })
    expect(result.cmd).toBe('claude')
  })

  it('picks opencode when config sets agent=opencode', async () => {
    const cwd = await tempCwd()
    await writeConfig(cwd, 'opencode')
    const result = resolveAgentCmd({ cwd, env: {} })
    expect(result.cmd).toBe('opencode')
    expect(result.args('x')).toEqual(['-p', 'x'])
    expect(result.streamFormat).toBe('text')
  })

  it('falls back to claude when config has an unknown agent value', async () => {
    const cwd = await tempCwd()
    await writeConfig(cwd, 'gemini')
    const result = resolveAgentCmd({ cwd, env: {} })
    expect(result.cmd).toBe('claude')
  })

  it('honors YORZ_AGENT_CMD env override for tests', async () => {
    const cwd = await tempCwd()
    await writeConfig(cwd, 'opencode')
    const result = resolveAgentCmd({ cwd, env: { YORZ_AGENT_CMD: '/tmp/fake-agent.js' } })
    expect(result.cmd).toBe('/tmp/fake-agent.js')
    expect(result.streamFormat).toBe('text')
  })
})
