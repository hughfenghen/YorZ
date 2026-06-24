import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addProject,
  generateProjectId,
  loadGlobalConfig,
  removeProject,
  resolveGlobalConfigDir,
  resolveGlobalConfigPath,
  saveGlobalConfig,
  touchProjectActivity,
} from '../global-config.js'

async function tmpConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yorz-global-config-'))
  return join(dir, 'projects.json')
}

describe('global-config: resolveGlobalConfigPath', () => {
  it('honors YORZ_HOME above XDG and ~/.config', () => {
    const dir = resolveGlobalConfigDir({ YORZ_HOME: '/tmp/yorz-home' })
    expect(dir).toBe('/tmp/yorz-home')
  })

  it('falls back to XDG_CONFIG_HOME when YORZ_HOME absent', () => {
    const dir = resolveGlobalConfigDir({ XDG_CONFIG_HOME: '/tmp/xdg' })
    expect(dir).toBe('/tmp/xdg/yorz')
  })

  it('default ends with /yorz/projects.json', () => {
    const fp = resolveGlobalConfigPath({})
    expect(fp.endsWith('/yorz/projects.json')).toBe(true)
  })
})

describe('loadGlobalConfig / saveGlobalConfig', () => {
  it('returns empty list when file missing', async () => {
    const fp = await tmpConfigPath()
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.version).toBe(1)
    expect(cfg.projects).toEqual([])
  })

  it('roundtrips via atomic save', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [{ id: 'x-abc123', path: '/tmp/x', addedAt: '2026-06-24', lastActivityAt: null }],
      },
      fp,
    )
    const raw = await readFile(fp, 'utf8')
    expect(raw).toContain('"x-abc123"')
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects).toEqual([
      { id: 'x-abc123', path: '/tmp/x', addedAt: '2026-06-24', lastActivityAt: null },
    ])
  })

  it('returns empty list when file is malformed JSON', async () => {
    const fp = await tmpConfigPath()
    await writeFile(fp, 'not-json', 'utf8')
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects).toEqual([])
  })
})

describe('generateProjectId', () => {
  it('is stable for the same absolute path', () => {
    const a = generateProjectId('/home/foo/MyProject')
    const b = generateProjectId('/home/foo/MyProject')
    expect(a).toBe(b)
    expect(a).toMatch(/^myproject-[0-9a-f]{6}$/)
  })

  it('falls back to proj- prefix when basename is empty', () => {
    const id = generateProjectId('/')
    expect(id).toMatch(/^proj-[0-9a-f]{6}$/)
  })
})

describe('addProject / removeProject / touchProjectActivity', () => {
  it('addProject is idempotent for same path', async () => {
    const fp = await tmpConfigPath()
    const r1 = await addProject('/tmp/p', fp)
    const r2 = await addProject('/tmp/p', fp)
    expect(r1.created).toBe(true)
    expect(r2.created).toBe(false)
    expect(r2.entry.id).toBe(r1.entry.id)
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects).toHaveLength(1)
  })

  it('removeProject returns false for unknown ids and does not throw', async () => {
    const fp = await tmpConfigPath()
    const removed = await removeProject('no-such', fp)
    expect(removed).toBe(false)
    expect(existsSync(fp)).toBe(false)
  })

  it('removeProject deletes when present', async () => {
    const fp = await tmpConfigPath()
    const { entry } = await addProject('/tmp/q', fp)
    const removed = await removeProject(entry.id, fp)
    expect(removed).toBe(true)
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects).toHaveLength(0)
  })

  it('touchProjectActivity only updates lastActivityAt', async () => {
    const fp = await tmpConfigPath()
    const { entry } = await addProject('/tmp/r', fp)
    const ok = await touchProjectActivity(entry.id, '2026-06-24T12:34:56Z', fp)
    expect(ok).toBe(true)
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects[0]!.path).toBe('/tmp/r')
    expect(cfg.projects[0]!.lastActivityAt).toBe('2026-06-24T12:34:56Z')
  })

  it('touchProjectActivity returns false for unknown id', async () => {
    const fp = await tmpConfigPath()
    const ok = await touchProjectActivity('no-such', '2026-06-24', fp)
    expect(ok).toBe(false)
  })
})
