import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { ProjectRegistry } from '../project-registry.js'
import { saveGlobalConfig } from '../global-config.js'

const registries: ProjectRegistry[] = []

async function newRegistry(): Promise<ProjectRegistry> {
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-registry-cfg-'))
  const reg = new ProjectRegistry({ globalConfigPath: join(cfgDir, 'projects.json') })
  registries.push(reg)
  return reg
}

async function newRegistryWithConfigPath(): Promise<{ reg: ProjectRegistry; configPath: string }> {
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-registry-cfg-'))
  const configPath = join(cfgDir, 'projects.json')
  const reg = new ProjectRegistry({ globalConfigPath: configPath })
  registries.push(reg)
  return { reg, configPath }
}

async function newProjectDir(prefix = 'yorz-registry-proj-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(dir, '.yorz'), { recursive: true })
  return dir
}

afterEach(async () => {
  for (const r of registries) await r.closeAll()
  registries.length = 0
})

describe('ProjectRegistry', () => {
  it('add() creates .yorz/specs and persists into global config', async () => {
    const reg = await newRegistry()
    const projDir = await newProjectDir()
    const r = await reg.add(projDir)
    expect(r.created).toBe(true)
    expect(r.entry.path).toBe(projDir)
    const list = await reg.list()
    expect(list.map((p) => p.id)).toContain(r.entry.id)
  })

  it('getOrCreate is lazy: first call creates instance, second reuses it', async () => {
    const reg = await newRegistry()
    const projDir = await newProjectDir()
    const { entry } = await reg.add(projDir)
    const a = await reg.getOrCreate(entry.id)
    const b = await reg.getOrCreate(entry.id)
    expect(a).toBe(b)
  })

  it('remove() closes the instance and removes from config', async () => {
    const reg = await newRegistry()
    const projDir = await newProjectDir()
    const { entry } = await reg.add(projDir)
    await reg.getOrCreate(entry.id)
    const removed = await reg.remove(entry.id)
    expect(removed).toBe(true)
    const after = await reg.list()
    expect(after.find((p) => p.id === entry.id)).toBeUndefined()
  })

  it('getOrCreate returns null for unknown id', async () => {
    const reg = await newRegistry()
    const got = await reg.getOrCreate('no-such-id')
    expect(got).toBeNull()
  })

  it('project agent inherits the global default in service runtime', async () => {
    const { reg, configPath } = await newRegistryWithConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'codex' },
        notifications: { sessionEnd: { banner: false, sound: false } },
      },
      configPath,
    )
    const projDir = await newProjectDir()
    const { entry } = await reg.add(projDir)
    const instance = await reg.getOrCreate(entry.id)
    const session = await instance!.sessions.ensureSessionForSpec('spec-a')
    expect(session.kind).toBe('codex')
  })
})
