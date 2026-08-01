import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import trash from 'trash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runGitChecked, runGitRaw } from '../git.js'
import type { GlobalProjectEntry } from '../global-config.js'
import type { ProjectRegistry } from '../project-registry.js'
import { WorktreeManager } from '../worktree-manager.js'

vi.mock('trash', () => ({ default: vi.fn() }))
vi.mock('../git.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../git.js')>()),
  runGitChecked: vi.fn(),
  runGitRaw: vi.fn(),
}))

const gitChecked = vi.mocked(runGitChecked)
const gitRaw = vi.mocked(runGitRaw)
const moveToTrash = vi.mocked(trash)

beforeEach(() => {
  vi.clearAllMocks()
  gitChecked.mockImplementation(async (_cwd, args) => ({
    stdout: args[0] === 'rev-parse' ? 'merge-head\n' : '',
    stderr: '',
  }))
  gitRaw.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
})

describe('WorktreeManager 清理事务', () => {
  it('releases the project first and preserves registry state when merge cleanup fails', async () => {
    const fixture = await makeFixture()
    moveToTrash.mockImplementation(async () => {
      fixture.order.push('trash')
      throw new Error('directory locked')
    })

    try {
      let thrown: unknown
      try {
        await fixture.manager.mergeBackToMain({ worktreeProjectId: fixture.worktree.id })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toMatchObject({ code: 'worktree_remove_failed' })
      expect(fixture.order[0]).toBe('release')
      expect(fixture.removed()).toBe(false)
      expect(gitRaw.mock.calls.some(([, args]) => args[0] === 'branch')).toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it('releases the project before deleting an unmerged worktree directory', async () => {
    const fixture = await makeFixture()
    moveToTrash.mockImplementation(async () => {
      fixture.order.push('trash')
      throw new Error('directory locked')
    })

    try {
      await expect(fixture.manager.removeWorktree(fixture.worktree.id)).rejects.toThrow(
        'directory locked',
      )
      expect(fixture.order).toEqual(['release', 'trash'])
      expect(fixture.removed()).toBe(false)
    } finally {
      await fixture.cleanup()
    }
  })

  it('deletes branch and registry only after the worktree path is gone', async () => {
    const fixture = await makeFixture()
    moveToTrash.mockImplementation(async (path) => {
      fixture.order.push('trash')
      await rm(path, { recursive: true, force: true })
    })

    try {
      const result = await fixture.manager.mergeBackToMain({
        worktreeProjectId: fixture.worktree.id,
      })

      expect(result.status).toBe('merged')
      expect(existsSync(fixture.worktree.path)).toBe(false)
      expect(fixture.order).toEqual(['release', 'trash', 'remove'])
      expect(gitRaw.mock.calls.some(([, args]) => args[0] === 'branch')).toBe(true)
    } finally {
      await fixture.cleanup()
    }
  })
})

/** 构造只覆盖清理边界的 registry 与真实目录，避免依赖平台特有文件锁。 */
async function makeFixture(): Promise<{
  manager: WorktreeManager
  worktree: GlobalProjectEntry
  order: string[]
  removed: () => boolean
  cleanup: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'yorz-worktree-manager-'))
  const mainPath = await mkdtemp(join(root, 'main-'))
  const worktreePath = await mkdtemp(join(root, 'worktree-'))
  const main: GlobalProjectEntry = {
    id: 'main',
    path: mainPath,
    addedAt: new Date().toISOString(),
    lastActivityAt: null,
  }
  const worktree: GlobalProjectEntry = {
    id: 'worktree',
    path: worktreePath,
    addedAt: new Date().toISOString(),
    lastActivityAt: null,
    worktree: {
      mainProjectId: main.id,
      mainPath,
      branch: 'wt/windows-p0',
      specId: 'spec',
      createdAt: new Date().toISOString(),
    },
  }
  const order: string[] = []
  let registryRemoved = false
  const registry = {
    findEntry: async (id: string) => (id === main.id ? main : id === worktree.id ? worktree : null),
    release: async () => {
      order.push('release')
    },
    remove: async () => {
      registryRemoved = true
      order.push('remove')
      return true
    },
    reload: async () => {},
  } as unknown as ProjectRegistry

  return {
    manager: new WorktreeManager({ registry }),
    worktree,
    order,
    removed: () => registryRemoved,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}
