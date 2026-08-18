import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProjectConfig, saveProjectConfig } from '../project-config.js'

async function projectWithConfig(config: unknown): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-cfg-instr-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  await writeFile(join(cwd, '.yorz/config.json'), JSON.stringify(config, null, 2), 'utf8')
  return cwd
}

describe('project config — customInstructions', () => {
  it('defaults to an empty list when the field is absent', async () => {
    const cwd = await projectWithConfig({ version: 1, agent: { kind: 'claude' } })
    expect((await loadProjectConfig(cwd)).customInstructions).toEqual([])
  })

  it('drops malformed entries and normalizes the name', async () => {
    const cwd = await projectWithConfig({
      version: 1,
      customInstructions: [
        { id: 'a', name: '/deploy', description: 'ship it', createdAt: 7 },
        { id: 'a', name: 'dup-id' },
        { id: 'b', name: 'bad name' },
      ],
    })
    const cfg = await loadProjectConfig(cwd)
    expect(cfg.customInstructions).toEqual([
      {
        id: 'a',
        name: 'deploy',
        description: 'ship it',
        hiddenPrompt: '',
        prefill: '',
        createdAt: 7,
      },
    ])
  })

  it('round-trips through save + load without dropping the field', async () => {
    const cwd = await projectWithConfig({ version: 1 })
    const cfg = await loadProjectConfig(cwd)
    cfg.customInstructions = [
      {
        id: 'x1',
        name: 'deploy',
        description: '',
        hiddenPrompt: '走发布流程',
        prefill: '只发布 web',
        createdAt: 42,
      },
    ]
    await saveProjectConfig(cwd, cfg)
    expect((await loadProjectConfig(cwd)).customInstructions).toEqual(cfg.customInstructions)
  })

  it('keeps instructions when an unrelated field is saved', async () => {
    const cwd = await projectWithConfig({
      version: 1,
      customInstructions: [{ id: 'x1', name: 'deploy', createdAt: 1 }],
    })
    const cfg = await loadProjectConfig(cwd)
    cfg.commands = [{ id: 'c1', name: 'dev', cli: 'pnpm dev', createdAt: 2 }]
    await saveProjectConfig(cwd, cfg)
    const next = await loadProjectConfig(cwd)
    expect(next.customInstructions.map((item) => item.name)).toEqual(['deploy'])
    expect(next.commands).toHaveLength(1)
  })
})
