import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InitAbortedError, runInit } from '../init.js'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'yorz-init-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe('runInit', () => {
  it('skips git init when .git already exists', async () => {
    await mkdir(join(cwd, '.git'), { recursive: true })
    let gitInitCalled = false
    const result = await runInit({
      cwd,
      isTTY: false,
      runGitInit: async () => {
        gitInitCalled = true
      },
    })
    expect(gitInitCalled).toBe(false)
    expect(result.gitInitialized).toBe(false)
    expect(result.yorzDirCreated).toBe(true)
    await stat(join(cwd, '.yorz'))
    const gi = await readFile(join(cwd, '.gitignore'), 'utf8')
    expect(gi).toContain('.yorz/tmp')
    expect(result.gitignore?.updated).toBe(true)
  })

  it('runs git init after interactive confirmation (y)', async () => {
    let gitInitCalled = false
    const result = await runInit({
      cwd,
      isTTY: true,
      prompt: async () => 'y',
      runGitInit: async (dir) => {
        gitInitCalled = true
        await mkdir(join(dir, '.git'), { recursive: true })
      },
    })
    expect(gitInitCalled).toBe(true)
    expect(result.gitInitialized).toBe(true)
    await stat(join(cwd, '.yorz'))
  })

  it('aborts when user answers no', async () => {
    await expect(
      runInit({
        cwd,
        isTTY: true,
        prompt: async () => 'n',
        runGitInit: async () => {
          throw new Error('should not run')
        },
      }),
    ).rejects.toBeInstanceOf(InitAbortedError)
    await expect(stat(join(cwd, '.yorz'))).rejects.toThrow()
  })

  it('runs git init non-interactively with yes=true', async () => {
    let gitInitCalled = false
    const result = await runInit({
      cwd,
      isTTY: false,
      yes: true,
      runGitInit: async (dir) => {
        gitInitCalled = true
        await mkdir(join(dir, '.git'), { recursive: true })
      },
    })
    expect(gitInitCalled).toBe(true)
    expect(result.gitInitialized).toBe(true)
  })

  it('aborts when non-TTY without --yes', async () => {
    await expect(
      runInit({
        cwd,
        isTTY: false,
        runGitInit: async () => {
          throw new Error('should not run')
        },
      }),
    ).rejects.toBeInstanceOf(InitAbortedError)
  })
})
