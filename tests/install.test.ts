import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install, SKILL_DIR_NAME } from '../src/cli/install.js'
import { uninstall } from '../src/cli/uninstall.js'
import skillContent from '../src/skill/SKILL.md?raw'

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

describe('install', () => {
  it('writes SKILL.md to claude user skills dir with inlined content', async () => {
    const res = await install({ agent: 'claude', scope: 'user', home, cwd })
    expect(res.path).toBe(join(home, '.claude', 'skills', SKILL_DIR_NAME, 'SKILL.md'))
    expect(res.overwritten).toBe(false)

    const content = await readFile(res.path, 'utf8')
    expect(content).toBe(skillContent)
    expect(content).toContain('name: yorz-spec')
  })

  it('overwrites an existing SKILL.md on second run', async () => {
    const first = await install({ agent: 'claude', scope: 'user', home, cwd })
    await writeFile(first.path, 'STALE', 'utf8')

    const second = await install({ agent: 'claude', scope: 'user', home, cwd })
    expect(second.overwritten).toBe(true)

    const content = await readFile(second.path, 'utf8')
    expect(content).toBe(skillContent)
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
