import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadGlobalConfig, saveGlobalConfig } from '../global-config.js'

async function globalWithConfig(config: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yorz-gcfg-agents-'))
  await mkdir(dir, { recursive: true })
  const fp = join(dir, 'config.json')
  await writeFile(fp, JSON.stringify(config, null, 2), 'utf8')
  return fp
}

describe('global config — customAgents normalization', () => {
  it('defaults to an empty list when absent or not an array', async () => {
    const a = await globalWithConfig({ version: 1, agent: { defaultKind: 'claude' } })
    expect((await loadGlobalConfig(a)).customAgents).toEqual([])
    const b = await globalWithConfig({ version: 1, customAgents: { x: 1 } })
    expect((await loadGlobalConfig(b)).customAgents).toEqual([])
  })

  it('keeps valid entries and drops malformed / builtin-colliding / duplicate ones', async () => {
    const fp = await globalWithConfig({
      version: 1,
      customAgents: [
        { id: 'my-agent', name: 'My Agent', module: 'yorz-agent-my-agent' },
        { id: 'local', module: '/abs/path/a.js' }, // name optional, absolute allowed
        { id: '', module: 'x' }, // blank id
        { id: 'no-module' }, // missing module
        { id: 'claude', module: 'hijack' }, // collides with builtin -> dropped
        { id: 'my-agent', module: 'dup' }, // duplicate id -> dropped
        'not-an-object',
        { id: ' trimmed ', name: ' T ', module: ' ./b.js ' }, // trimmed
      ],
    })
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.customAgents).toEqual([
      { id: 'my-agent', name: 'My Agent', module: 'yorz-agent-my-agent' },
      { id: 'local', module: '/abs/path/a.js' },
      { id: 'trimmed', name: 'T', module: './b.js' },
    ])
  })

  it('round-trips through saveGlobalConfig (whitelist keeps the field)', async () => {
    const fp = await globalWithConfig({
      version: 1,
      agent: { defaultKind: 'my-agent' },
      customAgents: [{ id: 'my-agent', module: './agents/a.js' }],
    })
    const cfg = await loadGlobalConfig(fp)
    await saveGlobalConfig(cfg, fp)
    const raw = JSON.parse(await readFile(fp, 'utf8')) as {
      customAgents: unknown
      agent: { defaultKind: string }
    }
    expect(raw.customAgents).toEqual([{ id: 'my-agent', module: './agents/a.js' }])
    expect(raw.agent.defaultKind).toBe('my-agent')
  })

  it('preserves an open agent.defaultKind (external id) verbatim', async () => {
    const fp = await globalWithConfig({ version: 1, agent: { defaultKind: 'some-external' } })
    expect((await loadGlobalConfig(fp)).agent).toEqual({ defaultKind: 'some-external' })
  })

  it('falls back to claude for a blank or non-string defaultKind', async () => {
    const a = await globalWithConfig({ version: 1, agent: { defaultKind: '  ' } })
    expect((await loadGlobalConfig(a)).agent).toEqual({ defaultKind: 'claude' })
    const b = await globalWithConfig({ version: 1, agent: { defaultKind: 42 } })
    expect((await loadGlobalConfig(b)).agent).toEqual({ defaultKind: 'claude' })
  })
})
