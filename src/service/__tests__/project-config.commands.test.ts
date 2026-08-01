import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProjectConfig, saveProjectConfig } from '../project-config.js'

async function projectWithConfig(config: unknown): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-cfg-cmd-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  await writeFile(join(cwd, '.yorz/config.json'), JSON.stringify(config, null, 2), 'utf8')
  return cwd
}

describe('project config — commands normalization', () => {
  it('defaults to an empty list when the field is absent', async () => {
    const cwd = await projectWithConfig({ version: 1, agent: { kind: 'claude' } })
    expect((await loadProjectConfig(cwd)).commands).toEqual([])
  })

  it('defaults to an empty list when the field is not an array', async () => {
    const cwd = await projectWithConfig({ version: 1, commands: { a: 1 } })
    expect((await loadProjectConfig(cwd)).commands).toEqual([])
  })

  it('keeps valid entries and drops malformed or duplicate ones', async () => {
    const cwd = await projectWithConfig({
      version: 1,
      commands: [
        { id: 'a', name: 'dev', cli: 'pnpm dev', createdAt: 111 },
        { id: 'b', name: '  ', cli: 'pnpm build', createdAt: 1 }, // blank name
        { id: '', name: 'x', cli: 'ls', createdAt: 1 }, // blank id
        { id: 'c', name: 'no-cli', createdAt: 1 }, // missing cli
        { id: 'a', name: 'dup', cli: 'ls', createdAt: 2 }, // duplicate id
        'not-an-object',
        { id: ' d ', name: ' test ', cli: ' pnpm test ' }, // trimmed, no createdAt
      ],
    })
    const cfg = await loadProjectConfig(cwd)
    expect(cfg.commands).toEqual([
      { id: 'a', name: 'dev', cli: 'pnpm dev', createdAt: 111 },
      { id: 'd', name: 'test', cli: 'pnpm test', createdAt: 0 },
    ])
  })

  it('round-trips commands through save + load', async () => {
    const cwd = await projectWithConfig({ version: 1 })
    const cfg = await loadProjectConfig(cwd)
    cfg.commands = [{ id: 'x1', name: 'dev', cli: 'pnpm dev', createdAt: 42 }]
    await saveProjectConfig(cwd, cfg)
    expect((await loadProjectConfig(cwd)).commands).toEqual([
      { id: 'x1', name: 'dev', cli: 'pnpm dev', createdAt: 42 },
    ])
  })
})
