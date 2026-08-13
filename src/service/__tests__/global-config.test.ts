import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addProject,
  generateProjectId,
  loadGlobalConfig,
  prepareProjectDir,
  removeProject,
  resolveGlobalConfigDir,
  resolveGlobalConfigPath,
  resolveGlobalSkillsDir,
  resolveSkillEntry,
  saveGlobalConfig,
  setProjectWorktree,
  touchProjectActivity,
} from '../global-config.js'

async function tmpConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yorz-global-config-'))
  return join(dir, 'config.json')
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

  it('default ends with /yorz/config.json', () => {
    const fp = resolveGlobalConfigPath({})
    expect(fp.endsWith('/yorz/config.json')).toBe(true)
  })
})

describe('global-config: shared skills dir', () => {
  it('resolveGlobalSkillsDir sits under the global config dir', () => {
    expect(resolveGlobalSkillsDir({ YORZ_HOME: '/tmp/yorz-home' })).toBe('/tmp/yorz-home/skills')
  })

  it('honors XDG_CONFIG_HOME when YORZ_HOME absent', () => {
    expect(resolveGlobalSkillsDir({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe('/tmp/xdg/yorz/skills')
  })

  it('default ends with /yorz/skills', () => {
    expect(resolveGlobalSkillsDir({}).endsWith('/yorz/skills')).toBe(true)
  })

  it('resolveSkillEntry points at <dir>/<skill>/SKILL.md', () => {
    expect(resolveSkillEntry('yorz-spec', { YORZ_HOME: '/tmp/yorz-home' })).toBe(
      '/tmp/yorz-home/skills/yorz-spec/SKILL.md',
    )
  })
})

describe('loadGlobalConfig / saveGlobalConfig', () => {
  it('returns empty list when file missing', async () => {
    const fp = await tmpConfigPath()
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.version).toBe(1)
    expect(cfg.projects).toEqual([])
    expect(cfg.agent).toEqual({ defaultKind: 'claude' })
    expect(cfg.notifications.sessionEnd).toEqual({ banner: false, sound: false })
    expect(cfg.shortcuts).toEqual({})
    expect(cfg.power).toEqual({ inhibitWhenRunning: 'system-default' })
    expect(cfg.appearance).toEqual({
      themeMode: 'system',
      themeName: 'terminal',
      language: 'zh-CN',
    })
    expect(cfg.customInstructions).toEqual([])
  })

  it('roundtrips via atomic save', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [{ id: 'x-abc123', path: '/tmp/x', addedAt: '2026-06-24', lastActivityAt: null }],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: false, sound: false } },
        shortcuts: {},
      },
      fp,
    )
    const raw = await readFile(fp, 'utf8')
    expect(raw).toContain('"x-abc123"')
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects).toEqual([
      { id: 'x-abc123', path: '/tmp/x', addedAt: '2026-06-24', lastActivityAt: null },
    ])
    expect(cfg.agent).toEqual({ defaultKind: 'claude' })
    expect(cfg.notifications.sessionEnd).toEqual({ banner: false, sound: false })
    expect(cfg.shortcuts).toEqual({})
    expect(cfg.power).toEqual({ inhibitWhenRunning: 'system-default' })
    expect(cfg.appearance).toEqual({
      themeMode: 'system',
      themeName: 'terminal',
      language: 'zh-CN',
    })
    expect(cfg.customInstructions).toEqual([])
  })

  it('returns empty list when file is malformed JSON', async () => {
    const fp = await tmpConfigPath()
    await writeFile(fp, 'not-json', 'utf8')
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects).toEqual([])
    expect(cfg.agent).toEqual({ defaultKind: 'claude' })
    expect(cfg.notifications.sessionEnd).toEqual({ banner: false, sound: false })
    expect(cfg.shortcuts).toEqual({})
    expect(cfg.power).toEqual({ inhibitWhenRunning: 'system-default' })
    expect(cfg.appearance).toEqual({
      themeMode: 'system',
      themeName: 'terminal',
      language: 'zh-CN',
    })
  })

  it('roundtrips session end notification preferences', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: true, sound: true } },
        shortcuts: {},
      },
      fp,
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.notifications.sessionEnd).toEqual({ banner: true, sound: true })
  })

  it('roundtrips global agent default', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'codex' },
        notifications: { sessionEnd: { banner: false, sound: false } },
        shortcuts: {},
      },
      fp,
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.agent).toEqual({ defaultKind: 'codex' })
  })

  it('normalizes legacy config without notifications', async () => {
    const fp = await tmpConfigPath()
    await writeFile(
      fp,
      JSON.stringify({
        version: 1,
        projects: [{ id: 'legacy', path: '/tmp/legacy', addedAt: 'x', lastActivityAt: null }],
      }),
      'utf8',
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects[0]!.id).toBe('legacy')
    expect(cfg.agent).toEqual({ defaultKind: 'claude' })
    expect(cfg.notifications.sessionEnd).toEqual({ banner: false, sound: false })
    expect(cfg.shortcuts).toEqual({})
    expect(cfg.power).toEqual({ inhibitWhenRunning: 'system-default' })
  })

  it('roundtrips shortcut overrides', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: false, sound: false } },
        shortcuts: { newSpec: 'ctrl+shift+k', projectSettings: null },
      },
      fp,
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.shortcuts).toEqual({ newSpec: 'Ctrl+Shift+K', projectSettings: null })
  })

  it('roundtrips power inhibit preference', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: false, sound: false } },
        shortcuts: {},
        power: { inhibitWhenRunning: 'keep-system-awake' },
      },
      fp,
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.power).toEqual({ inhibitWhenRunning: 'keep-system-awake' })
  })

  it('normalizes invalid power inhibit preference to system default', async () => {
    const fp = await tmpConfigPath()
    await writeFile(
      fp,
      JSON.stringify({
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: false, sound: false } },
        shortcuts: {},
        power: { inhibitWhenRunning: 'invalid' },
      }),
      'utf8',
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.power).toEqual({ inhibitWhenRunning: 'system-default' })
  })

  it('roundtrips appearance and custom instructions', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: false, sound: false } },
        shortcuts: {},
        appearance: { themeMode: 'dark', themeName: 'paper', language: 'en' },
        customInstructions: [
          {
            id: 'commit',
            name: '/commit',
            description: 'Commit changes',
            systemPrompt: 'Commit related files',
            prefill: '/commit ',
            createdAt: 1785511681636,
          },
        ],
      },
      fp,
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.appearance).toEqual({ themeMode: 'dark', themeName: 'paper', language: 'en' })
    expect(cfg.customInstructions).toEqual([
      {
        id: 'commit',
        name: 'commit',
        description: 'Commit changes',
        systemPrompt: 'Commit related files',
        prefill: '/commit ',
        createdAt: 1785511681636,
      },
    ])
  })

  it('reads legacy projects.json when config.json is missing', async () => {
    const fp = await tmpConfigPath()
    const legacy = join(dirname(fp), 'projects.json')
    await writeFile(
      legacy,
      JSON.stringify({
        version: 1,
        projects: [{ id: 'legacy', path: '/tmp/legacy', addedAt: 'x', lastActivityAt: null }],
        agent: { defaultKind: 'codex' },
      }),
      'utf8',
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects[0]!.id).toBe('legacy')
    expect(cfg.agent).toEqual({ defaultKind: 'codex' })
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

describe('prepareProjectDir', () => {
  it('resolves relative path against provided cwd', async () => {
    const base = await mkdtemp(join(tmpdir(), 'yorz-prep-cwd-'))
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(base, 'sub'))
    const abs = await prepareProjectDir('./sub', base)
    expect(abs).toBe(join(base, 'sub'))
    expect(existsSync(join(abs, '.yorz', 'specs'))).toBe(true)
  })

  it('rejects when path does not exist', async () => {
    const base = await mkdtemp(join(tmpdir(), 'yorz-prep-missing-'))
    await expect(prepareProjectDir(join(base, 'does-not-exist'))).rejects.toThrow(
      /path does not exist/,
    )
  })

  it('rejects when path is a file rather than a directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'yorz-prep-file-'))
    const filePath = join(base, 'a.txt')
    await writeFile(filePath, 'hi', 'utf8')
    await expect(prepareProjectDir(filePath)).rejects.toThrow(/not a directory/)
    expect(existsSync(join(base, '.yorz'))).toBe(false)
  })

  it('creates .yorz/specs and returns normalized absolute path for absolute input', async () => {
    const base = await mkdtemp(join(tmpdir(), 'yorz-prep-abs-'))
    const abs = await prepareProjectDir(base)
    expect(abs).toBe(base)
    expect(existsSync(join(base, '.yorz', 'specs'))).toBe(true)
  })
})

describe('WorktreeMeta cleanSlug normalization', () => {
  it('preserves cleanSlug when present', async () => {
    const fp = await tmpConfigPath()
    const { entry } = await addProject('/tmp/wt-test', fp)
    await setProjectWorktree(
      entry.id,
      {
        mainProjectId: 'main-abc',
        mainPath: '/tmp/main',
        branch: 'wt/260630-feat-some-task',
        specId: '',
        createdAt: '2026-06-30T00:00:00Z',
        cleanSlug: 'some-task',
      },
      fp,
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects[0]!.worktree?.cleanSlug).toBe('some-task')
  })

  it('cleanSlug is undefined when absent (backward compatible)', async () => {
    const fp = await tmpConfigPath()
    const { entry } = await addProject('/tmp/wt-old', fp)
    await setProjectWorktree(
      entry.id,
      {
        mainProjectId: 'main-abc',
        mainPath: '/tmp/main',
        branch: 'wt/260630-feat-some-task',
        specId: '',
        createdAt: '2026-06-30T00:00:00Z',
      },
      fp,
    )
    const cfg = await loadGlobalConfig(fp)
    expect(cfg.projects[0]!.worktree?.cleanSlug).toBeUndefined()
  })
})
