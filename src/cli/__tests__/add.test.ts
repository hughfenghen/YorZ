import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AddGitAbortedError, runAdd } from '../add.js'
import { loadGlobalConfig } from '../../service/global-config.js'

async function tmpConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yorz-add-cfg-'))
  return join(dir, 'projects.json')
}

async function tmpProjectDir(prefix = 'yorz-add-proj-'): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

async function tmpGitProjectDir(prefix = 'yorz-add-proj-'): Promise<string> {
  const dir = await tmpProjectDir(prefix)
  await mkdir(join(dir, '.git'), { recursive: true })
  return dir
}

describe('runAdd', () => {
  it('creates a new project entry from an absolute path', async () => {
    const projectDir = await tmpGitProjectDir()
    const cfg = await tmpConfigPath()
    const { entry, created, gitInitialized } = await runAdd({
      path: projectDir,
      globalConfigPath: cfg,
    })
    expect(created).toBe(true)
    expect(gitInitialized).toBe(false)
    expect(entry.path).toBe(projectDir)
    const loaded = await loadGlobalConfig(cfg)
    expect(loaded.projects).toHaveLength(1)
    expect(loaded.projects[0]!.id).toBe(entry.id)
  })

  it('is idempotent on second add', async () => {
    const projectDir = await tmpGitProjectDir()
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
    await mkdir(join(base, 'subproj', '.git'), { recursive: true })
    const cfg = await tmpConfigPath()
    const { entry, created } = await runAdd({
      path: './subproj',
      cwd: base,
      globalConfigPath: cfg,
    })
    expect(created).toBe(true)
    expect(entry.path).toBe(join(base, 'subproj'))
  })

  it('skips git init when .git already exists and updates .gitignore', async () => {
    const projectDir = await tmpGitProjectDir()
    const cfg = await tmpConfigPath()
    let gitInitCalled = false
    const result = await runAdd({
      path: projectDir,
      globalConfigPath: cfg,
      isTTY: false,
      runGitInit: async () => {
        gitInitCalled = true
      },
    })
    expect(gitInitCalled).toBe(false)
    expect(result.gitInitialized).toBe(false)
    const gi = await readFile(join(projectDir, '.gitignore'), 'utf8')
    expect(gi).toContain('.yorz/tmp')
    expect(result.gitignore?.updated).toBe(true)
  })

  it('runs git init non-interactively with yes=true', async () => {
    const projectDir = await tmpProjectDir()
    const cfg = await tmpConfigPath()
    let gitInitCalled = false
    const result = await runAdd({
      path: projectDir,
      globalConfigPath: cfg,
      isTTY: false,
      yes: true,
      runGitInit: async (dir) => {
        gitInitCalled = true
        await mkdir(join(dir, '.git'), { recursive: true })
      },
    })
    expect(gitInitCalled).toBe(true)
    expect(result.gitInitialized).toBe(true)
    expect(result.created).toBe(true)
  })

  it('runs git init after interactive confirmation (y)', async () => {
    const projectDir = await tmpProjectDir()
    const cfg = await tmpConfigPath()
    let gitInitCalled = false
    const result = await runAdd({
      path: projectDir,
      globalConfigPath: cfg,
      isTTY: true,
      prompt: async () => 'y',
      runGitInit: async (dir) => {
        gitInitCalled = true
        await mkdir(join(dir, '.git'), { recursive: true })
      },
    })
    expect(gitInitCalled).toBe(true)
    expect(result.gitInitialized).toBe(true)
  })

  it('aborts when user answers no', async () => {
    const projectDir = await tmpProjectDir()
    const cfg = await tmpConfigPath()
    await expect(
      runAdd({
        path: projectDir,
        globalConfigPath: cfg,
        isTTY: true,
        prompt: async () => 'n',
        runGitInit: async () => {
          throw new Error('should not run')
        },
      }),
    ).rejects.toBeInstanceOf(AddGitAbortedError)
    const loaded = await loadGlobalConfig(cfg)
    expect(loaded.projects).toEqual([])
  })

  it('aborts when non-TTY without --yes', async () => {
    const projectDir = await tmpProjectDir()
    const cfg = await tmpConfigPath()
    await expect(
      runAdd({
        path: projectDir,
        globalConfigPath: cfg,
        isTTY: false,
        runGitInit: async () => {
          throw new Error('should not run')
        },
      }),
    ).rejects.toBeInstanceOf(AddGitAbortedError)
    const loaded = await loadGlobalConfig(cfg)
    expect(loaded.projects).toEqual([])
  })
})
