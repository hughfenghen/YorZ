import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install, SKILL_DIR_NAME } from '../install.js'
import { uninstall } from '../uninstall.js'
import { INSTALL_SCOPE_DEFAULT, installScopeTip } from '../defaults.js'

let home: string
let cwd: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yorz-home-'))
  cwd = await mkdtemp(join(tmpdir(), 'yorz-cwd-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(cwd, { recursive: true, force: true })
})

const EXPECTED_SUBDOCS = [
  'SKILL.md',
  'index.json',
  'stages.md',
  'review.md',
]

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    const entries = await readdir(cur, { withFileTypes: true })
    for (const e of entries) {
      const p = join(cur, e.name)
      if (e.isDirectory()) stack.push(p)
      else out.push(p)
    }
  }
  return out
}

describe('install', () => {
  it('writes SKILL.md plus all sub-documents to claude user skills dir', async () => {
    const res = await install({ agent: 'claude', scope: 'user', home, cwd })
    const skillDir = join(home, '.claude', 'skills', SKILL_DIR_NAME)
    expect(res.path).toBe(join(skillDir, 'SKILL.md'))
    expect(res.overwritten).toBe(false)

    const written = (await walk(skillDir)).map((p) => p.slice(skillDir.length + 1)).sort()
    for (const expected of EXPECTED_SUBDOCS) {
      expect(written).toContain(expected)
    }

    const main = await readFile(res.path, 'utf8')
    expect(main).toContain('name: yorz-spec')
  })

  it('excludes the __tests__/ directory from the installed skill', async () => {
    await install({ agent: 'claude', scope: 'user', home, cwd })
    const skillDir = join(home, '.claude', 'skills', SKILL_DIR_NAME)
    const written = await walk(skillDir)
    expect(written.every((p) => !p.includes('__tests__'))).toBe(true)
  })

  it('wipes a previously installed yorz-spec/ before re-writing (no stale files)', async () => {
    const first = await install({ agent: 'claude', scope: 'user', home, cwd })
    const skillDir = join(home, '.claude', 'skills', SKILL_DIR_NAME)
    const stalePath = join(skillDir, 'stale-leftover.md')
    await writeFile(stalePath, 'STALE', 'utf8')
    await writeFile(first.path, 'OVERWRITTEN ENTRY', 'utf8')

    const second = await install({ agent: 'claude', scope: 'user', home, cwd })
    expect(second.overwritten).toBe(true)

    await expect(stat(stalePath)).rejects.toThrow()
    const main = await readFile(second.path, 'utf8')
    expect(main).toContain('name: yorz-spec')
  })

  it('writes to project .claude/skills when scope=project', async () => {
    const res = await install({ agent: 'claude', scope: 'project', home, cwd })
    expect(res.path).toBe(join(cwd, '.claude', 'skills', SKILL_DIR_NAME, 'SKILL.md'))
  })

  it('writes to opencode user dir', async () => {
    const res = await install({ agent: 'opencode', scope: 'user', home, cwd })
    expect(res.path).toBe(join(home, '.config', 'opencode', 'skills', SKILL_DIR_NAME, 'SKILL.md'))
  })
})

describe('install · .gitignore handling', () => {
  it('appends .yorz/tmp to a missing .gitignore when cwd is a git repo', async () => {
    await mkdir(join(cwd, '.git'), { recursive: true })
    const res = await install({ agent: 'claude', scope: 'user', home, cwd })
    expect(res.gitignore?.updated).toBe(true)
    const giPath = join(cwd, '.gitignore')
    expect(res.gitignore?.path).toBe(giPath)
    const content = await readFile(giPath, 'utf8')
    expect(content).toBe('.yorz/tmp\n')
  })

  it('is idempotent when .gitignore already includes .yorz/tmp', async () => {
    await mkdir(join(cwd, '.git'), { recursive: true })
    const giPath = join(cwd, '.gitignore')
    await writeFile(giPath, 'node_modules\n.yorz/tmp\ndist\n', 'utf8')
    const res = await install({ agent: 'claude', scope: 'user', home, cwd })
    expect(res.gitignore).toEqual({ updated: false, path: giPath })
    const content = await readFile(giPath, 'utf8')
    expect(content).toBe('node_modules\n.yorz/tmp\ndist\n')
  })

  it('does nothing when cwd is not a git repository', async () => {
    const res = await install({ agent: 'claude', scope: 'user', home, cwd })
    expect(res.gitignore).toBeNull()
    await expect(stat(join(cwd, '.gitignore'))).rejects.toThrow()
  })
})

describe('CLI defaults', () => {
  it('INSTALL_SCOPE_DEFAULT is "user"', () => {
    expect(INSTALL_SCOPE_DEFAULT).toBe('user')
  })
})

describe('installScopeTip', () => {
  it('returns a tip when scope came from the default (user did not pass -s)', () => {
    const tip = installScopeTip('default')
    expect(tip).not.toBeNull()
    expect(tip).toContain('--scope user')
    expect(tip).toContain('pass -s project')
  })

  it('also returns a tip when the option source is undefined', () => {
    expect(installScopeTip(undefined)).not.toBeNull()
  })

  it('returns null when the user explicitly passed -s (CLI source)', () => {
    expect(installScopeTip('cli')).toBeNull()
  })

  it('returns null when the option was set from env or config', () => {
    expect(installScopeTip('env')).toBeNull()
    expect(installScopeTip('config')).toBeNull()
  })
})

describe('uninstall', () => {
  it('removes an installed skill dir', async () => {
    await install({ agent: 'claude', scope: 'user', home, cwd })
    const res = await uninstall({ agent: 'claude', scope: 'user', home, cwd })

    expect(res.removed).toBe(true)
    await expect(stat(res.path)).rejects.toThrow()
  })

  it('returns removed=false when nothing to remove', async () => {
    const res = await uninstall({ agent: 'claude', scope: 'user', home, cwd })
    expect(res.removed).toBe(false)
  })

  it('removes a non-empty skill dir (with extra files)', async () => {
    await install({ agent: 'opencode', scope: 'project', home, cwd })
    const dir = join(cwd, '.opencode', 'skills', SKILL_DIR_NAME)
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(join(dir, 'nested', 'extra.txt'), 'x', 'utf8')

    const res = await uninstall({ agent: 'opencode', scope: 'project', home, cwd })
    expect(res.removed).toBe(true)
    await expect(stat(dir)).rejects.toThrow()
  })
})
