import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { ProjectRegistry } from '../project-registry.js'
import { saveGlobalConfig } from '../global-config.js'

const registries: ProjectRegistry[] = []

async function newRegistry(): Promise<ProjectRegistry> {
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-registry-cfg-'))
  const reg = new ProjectRegistry({ globalConfigPath: join(cfgDir, 'config.json') })
  registries.push(reg)
  return reg
}

async function newRegistryWithConfigPath(): Promise<{ reg: ProjectRegistry; configPath: string }> {
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-registry-cfg-'))
  const configPath = join(cfgDir, 'config.json')
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

  it('list() reports running=false for projects with no in-flight session', async () => {
    const reg = await newRegistry()
    const projDir = await newProjectDir()
    const { entry } = await reg.add(projDir)
    // 未 materialize 时也必须有明确的 running=false，而不是触发 getOrCreate。
    const list = await reg.list()
    expect(list.find((p) => p.id === entry.id)?.running).toBe(false)
    // materialize 后仍无 in-flight turn → 依旧 false。
    await reg.getOrCreate(entry.id)
    const list2 = await reg.list()
    expect(list2.find((p) => p.id === entry.id)?.running).toBe(false)
  })

  it('setSessionActivityListener fires on session running status changes', async () => {
    const reg = await newRegistry()
    const projDir = await newProjectDir()
    const { entry } = await reg.add(projDir)
    let fired = 0
    reg.setSessionActivityListener(() => {
      fired += 1
    })
    const instance = await reg.getOrCreate(entry.id)
    // 直接驱动一次 status 翻转，验证监听器被回调（无需真实 agent 运行）。
    instance!.sessions['setRunning']('sid-1', true)
    expect(fired).toBe(1)
    expect(instance!.sessions.hasRunningSession()).toBe(true)
    instance!.sessions['setRunning']('sid-1', false)
    expect(fired).toBe(2)
    expect(instance!.sessions.hasRunningSession()).toBe(false)
  })

  it('project agent inherits the global default in service runtime', async () => {
    const { reg, configPath } = await newRegistryWithConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'codex' },
        notifications: { sessionEnd: { banner: false, sound: false }, push: { enabled: false } },
        shortcuts: {},
      },
      configPath,
    )
    const projDir = await newProjectDir()
    const { entry } = await reg.add(projDir)
    const instance = await reg.getOrCreate(entry.id)
    const session = await instance!.sessions.createSessionForSpec('spec-a')
    expect(session.kind).toBe('codex')
  })
})
