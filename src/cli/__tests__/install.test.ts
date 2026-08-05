import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupLegacyAgentSkills,
  computeBundledFingerprint,
  ensureSkillsInstalled,
  install,
  readInstalledFingerprint,
  SKILL_DIR_NAME,
  SKILL_DIR_NAMES,
} from '../install.js'
import { uninstall } from '../uninstall.js'

let home: string
let cwd: string
let skillsDir: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'yorz-home-'))
  cwd = await mkdtemp(join(tmpdir(), 'yorz-cwd-'))
  skillsDir = join(await mkdtemp(join(tmpdir(), 'yorz-cfg-')), 'skills')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(cwd, { recursive: true, force: true })
  await rm(join(skillsDir, '..'), { recursive: true, force: true })
})

const EXPECTED_SUBDOCS = ['SKILL.md', 'index.json', 'stages.md', 'review.md']

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
  it('writes SKILL.md plus all sub-documents to the shared skills dir', async () => {
    const res = await install({ skillsDir, cwd })
    const skillDir = join(skillsDir, SKILL_DIR_NAME)
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
    await install({ skillsDir, cwd })
    const written = await walk(join(skillsDir, SKILL_DIR_NAME))
    expect(written.every((p) => !p.includes('__tests__'))).toBe(true)
  })

  it('wipes a previously installed yorz-spec/ before re-writing (no stale files)', async () => {
    const first = await install({ skillsDir, cwd })
    const skillDir = join(skillsDir, SKILL_DIR_NAME)
    const stalePath = join(skillDir, 'stale-leftover.md')
    await writeFile(stalePath, 'STALE', 'utf8')
    await writeFile(first.path, 'OVERWRITTEN ENTRY', 'utf8')

    const second = await install({ skillsDir, cwd })
    expect(second.overwritten).toBe(true)

    await expect(stat(stalePath)).rejects.toThrow()
    const main = await readFile(second.path, 'utf8')
    expect(main).toContain('name: yorz-spec')
  })

  it('leaves sibling skills under the shared dir untouched', async () => {
    await install({ skillsDir, cwd }, 'yorz-spec')
    await install({ skillsDir, cwd }, 'yorz-debug')
    await expect(stat(join(skillsDir, 'yorz-spec', 'SKILL.md'))).resolves.toBeTruthy()
    await expect(stat(join(skillsDir, 'yorz-debug', 'SKILL.md'))).resolves.toBeTruthy()
  })

  it('does not write into any Agent skills directory', async () => {
    await install({ skillsDir, cwd })
    await expect(stat(join(home, '.claude', 'skills'))).rejects.toThrow()
    await expect(stat(join(cwd, '.claude', 'skills'))).rejects.toThrow()
  })
})

describe('skill fingerprint', () => {
  it('computeBundledFingerprint is stable and a hex sha-256 digest', () => {
    const a = computeBundledFingerprint()
    const b = computeBundledFingerprint()
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('readInstalledFingerprint returns null when SKILL.md is absent', async () => {
    expect(await readInstalledFingerprint(join(skillsDir, SKILL_DIR_NAME))).toBeNull()
  })

  it('readInstalledFingerprint matches the bundled fingerprint after install', async () => {
    await install({ skillsDir, cwd })
    expect(await readInstalledFingerprint(join(skillsDir, SKILL_DIR_NAME))).toBe(
      computeBundledFingerprint(),
    )
  })

  it('readInstalledFingerprint changes when an installed file is edited', async () => {
    await install({ skillsDir, cwd })
    const skillDir = join(skillsDir, SKILL_DIR_NAME)
    await writeFile(join(skillDir, 'SKILL.md'), 'TAMPERED', 'utf8')
    expect(await readInstalledFingerprint(skillDir)).not.toBe(computeBundledFingerprint())
  })
})

describe('ensureSkillsInstalled', () => {
  it('installs one copy of every skill on first run', async () => {
    const results = await ensureSkillsInstalled({ skillsDir, cwd })
    expect(results).toHaveLength(SKILL_DIR_NAMES.length)
    expect(results.map((r) => r.skill).sort()).toEqual(['yorz-debug', 'yorz-spec'])
    expect(results.every((r) => r.status === 'installed')).toBe(true)
    for (const r of results) {
      expect(r.path.startsWith(skillsDir)).toBe(true)
      await expect(stat(r.path)).resolves.toBeTruthy()
    }
  })

  it('reports up-to-date on a second run with no changes', async () => {
    await ensureSkillsInstalled({ skillsDir, cwd })
    const results = await ensureSkillsInstalled({ skillsDir, cwd })
    expect(results.every((r) => r.status === 'up-to-date')).toBe(true)
  })

  it('reports updated only for the outdated skill', async () => {
    await ensureSkillsInstalled({ skillsDir, cwd })
    await writeFile(join(skillsDir, SKILL_DIR_NAME, 'SKILL.md'), 'OUTDATED', 'utf8')

    const results = await ensureSkillsInstalled({ skillsDir, cwd })
    expect(results.find((r) => r.skill === SKILL_DIR_NAME)!.status).toBe('updated')
    expect(
      results.filter((r) => r.skill !== SKILL_DIR_NAME).every((r) => r.status === 'up-to-date'),
    ).toBe(true)
    expect(await readInstalledFingerprint(join(skillsDir, SKILL_DIR_NAME))).toBe(
      computeBundledFingerprint(),
    )
  })
})

describe('install · .gitignore handling', () => {
  it('appends .yorz/tmp to a missing .gitignore when cwd is a git repo', async () => {
    await mkdir(join(cwd, '.git'), { recursive: true })
    const res = await install({ skillsDir, cwd })
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
    const res = await install({ skillsDir, cwd })
    expect(res.gitignore).toEqual({ updated: false, path: giPath })
    const content = await readFile(giPath, 'utf8')
    expect(content).toBe('node_modules\n.yorz/tmp\ndist\n')
  })

  it('does nothing when cwd is not a git repository', async () => {
    const res = await install({ skillsDir, cwd })
    expect(res.gitignore).toBeNull()
    await expect(stat(join(cwd, '.gitignore'))).rejects.toThrow()
  })
})

describe('cleanupLegacyAgentSkills', () => {
  async function seedLegacySkill(dir: string, frontmatterName: string): Promise<void> {
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'SKILL.md'),
      `---\nname: ${frontmatterName}\ndescription: x\n---\n\nbody\n`,
      'utf8',
    )
  }

  it('removes skill dirs written by older versions into Agent skills dirs', async () => {
    const claudeUser = join(home, '.claude', 'skills', 'yorz-spec')
    const opencodeUser = join(home, '.config', 'opencode', 'skills', 'yorz-debug')
    const codexProject = join(cwd, '.codex', 'skills', 'yorz-spec')
    await seedLegacySkill(claudeUser, 'yorz-spec')
    await seedLegacySkill(opencodeUser, 'yorz-debug')
    await seedLegacySkill(codexProject, 'yorz-spec')

    const results = await cleanupLegacyAgentSkills({ home, cwd })

    for (const dir of [claudeUser, opencodeUser, codexProject]) {
      expect(results.find((r) => r.path === dir)!.removed).toBe(true)
      await expect(stat(dir)).rejects.toThrow()
    }
  })

  it('keeps a user-authored skill that only shares the directory name', async () => {
    const foreign = join(home, '.claude', 'skills', 'yorz-spec')
    await seedLegacySkill(foreign, 'my-own-spec-helper')

    const results = await cleanupLegacyAgentSkills({ home, cwd })

    const entry = results.find((r) => r.path === foreign)!
    expect(entry.removed).toBe(false)
    expect(entry.reason).toBe('foreign')
    await expect(stat(join(foreign, 'SKILL.md'))).resolves.toBeTruthy()
  })

  it('reports absent for directories that were never installed', async () => {
    const results = await cleanupLegacyAgentSkills({ home, cwd })
    expect(results.every((r) => r.reason === 'absent')).toBe(true)
    expect(results).toHaveLength(6 * SKILL_DIR_NAMES.length)
  })

  it('never touches the shared global skills dir', async () => {
    await ensureSkillsInstalled({ skillsDir, cwd })
    await cleanupLegacyAgentSkills({ home, cwd })
    await expect(stat(join(skillsDir, SKILL_DIR_NAME, 'SKILL.md'))).resolves.toBeTruthy()
  })
})

describe('uninstall', () => {
  it('removes an installed skill dir', async () => {
    await install({ skillsDir, cwd })
    const results = await uninstall({ skillsDir })

    const spec = results.find((r) => r.skill === SKILL_DIR_NAME)!
    expect(spec.removed).toBe(true)
    await expect(stat(spec.path)).rejects.toThrow()
  })

  it('returns removed=false when nothing to remove', async () => {
    const results = await uninstall({ skillsDir })
    expect(results.every((r) => !r.removed)).toBe(true)
  })

  it('removes a non-empty skill dir (with extra files)', async () => {
    await install({ skillsDir, cwd })
    const dir = join(skillsDir, SKILL_DIR_NAME)
    await mkdir(join(dir, 'nested'), { recursive: true })
    await writeFile(join(dir, 'nested', 'extra.txt'), 'x', 'utf8')

    const results = await uninstall({ skillsDir })
    expect(results.find((r) => r.skill === SKILL_DIR_NAME)!.removed).toBe(true)
    await expect(stat(dir)).rejects.toThrow()
  })

  it('removes every bundled skill in one call', async () => {
    await ensureSkillsInstalled({ skillsDir, cwd })
    const results = await uninstall({ skillsDir })
    expect(results.every((r) => r.removed)).toBe(true)
    expect(results).toHaveLength(SKILL_DIR_NAMES.length)
  })
})
