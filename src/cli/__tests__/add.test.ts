import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runAdd } from '../add.js'
import { loadGlobalConfig } from '../../service/global-config.js'

async function tmpConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yorz-add-cfg-'))
  return join(dir, 'projects.json')
}

describe('runAdd', () => {
  it('creates a new project entry from an absolute path', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'yorz-add-proj-'))
    const cfg = await tmpConfigPath()
    const { entry, created } = await runAdd({ path: projectDir, globalConfigPath: cfg })
    expect(created).toBe(true)
    expect(entry.path).toBe(projectDir)
    const loaded = await loadGlobalConfig(cfg)
    expect(loaded.projects).toHaveLength(1)
    expect(loaded.projects[0]!.id).toBe(entry.id)
  })

  it('is idempotent on second add', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'yorz-add-proj-'))
    const cfg = await tmpConfigPath()
    const first = await runAdd({ path: projectDir, globalConfigPath: cfg })
    const second = await runAdd({ path: projectDir, globalConfigPath: cfg })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.entry.id).toBe(first.entry.id)
    const loaded = await loadGlobalConfig(cfg)
    expect(loaded.projects).toHaveLength(1)
  })

  it('rejects when path points to a file rather than a directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'yorz-add-file-'))
    const filePath = join(base, 'a.txt')
    await writeFile(filePath, 'hi', 'utf8')
    const cfg = await tmpConfigPath()
    await expect(runAdd({ path: filePath, globalConfigPath: cfg })).rejects.toThrow(
      /not a directory/,
    )
    const loaded = await loadGlobalConfig(cfg)
    expect(loaded.projects).toEqual([])
  })

  it('resolves relative path against explicit cwd', async () => {
    const base = await mkdtemp(join(tmpdir(), 'yorz-add-rel-'))
    await mkdir(join(base, 'subproj'))
    const cfg = await tmpConfigPath()
    const { entry, created } = await runAdd({
      path: './subproj',
      cwd: base,
      globalConfigPath: cfg,
    })
    expect(created).toBe(true)
    expect(entry.path).toBe(join(base, 'subproj'))
  })
})
