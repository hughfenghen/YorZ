import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { GitError, assertSafeRelativePath, commit, listChanges } from '../git.js'

const execFileP = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd })
  return stdout
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yorz-git-'))
  await git(dir, ['init', '-q', '-b', 'main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Test'])
  await git(dir, ['config', 'commit.gpgsign', 'false'])
  await writeFile(join(dir, '.gitkeep'), '', 'utf8')
  await git(dir, ['add', '.'])
  await git(dir, ['commit', '-q', '-m', 'init'])
  return dir
}

describe('git.listChanges', () => {
  it('parses M / A / D / ?? changes from porcelain output', async () => {
    const cwd = await initRepo()
    // Seed a tracked file we can later modify or delete.
    await writeFile(join(cwd, 'tracked.txt'), 'orig\n', 'utf8')
    await git(cwd, ['add', 'tracked.txt'])
    await git(cwd, ['commit', '-q', '-m', 'seed'])

    // Seed a separate file that will be deleted in the test below.
    await writeFile(join(cwd, 'will-delete.txt'), 'x\n', 'utf8')
    await git(cwd, ['add', 'will-delete.txt'])
    await git(cwd, ['commit', '-q', '-m', 'set up delete'])

    // Modify tracked, add new untracked, stage a brand-new add, delete one.
    await writeFile(join(cwd, 'tracked.txt'), 'changed\n', 'utf8')
    await writeFile(join(cwd, 'untracked.txt'), 'new\n', 'utf8')
    await writeFile(join(cwd, 'added.txt'), 'staged\n', 'utf8')
    await git(cwd, ['add', 'added.txt'])
    await rm(join(cwd, 'will-delete.txt'))

    const changes = await listChanges(cwd)
    const byPath = Object.fromEntries(changes.map((c) => [c.path, c]))
    expect(byPath['tracked.txt']?.status).toBe('M')
    expect(byPath['added.txt']?.status).toBe('A')
    expect(byPath['will-delete.txt']?.status).toBe('D')
    expect(byPath['untracked.txt']?.status).toBe('??')

    await rm(cwd, { recursive: true, force: true })
  })
})

describe('git.commit', () => {
  it('stages and commits exactly the requested paths', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'a.txt'), 'a\n', 'utf8')
    await writeFile(join(cwd, 'b.txt'), 'b\n', 'utf8')
    const { commit: sha } = await commit(cwd, { message: 'add a', paths: ['a.txt'] })
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    const logged = (await git(cwd, ['log', '-1', '--name-only', '--pretty='])).trim()
    expect(logged).toBe('a.txt')
    // b.txt should still be untracked.
    const status = await listChanges(cwd)
    expect(status.find((c) => c.path === 'b.txt')?.status).toBe('??')
    await rm(cwd, { recursive: true, force: true })
  })

  it('rejects out-of-tree paths via GitError', async () => {
    const cwd = await initRepo()
    await expect(commit(cwd, { message: 'm', paths: ['../escape.txt'] })).rejects.toBeInstanceOf(
      GitError,
    )
    await rm(cwd, { recursive: true, force: true })
  })

  it('rejects empty messages', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'x.txt'), 'x\n', 'utf8')
    await expect(commit(cwd, { message: '   ', paths: ['x.txt'] })).rejects.toBeInstanceOf(GitError)
    await rm(cwd, { recursive: true, force: true })
  })
})

describe('assertSafeRelativePath', () => {
  it('accepts simple relative paths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-safe-'))
    await mkdir(join(cwd, 'sub'), { recursive: true })
    expect(() => assertSafeRelativePath(cwd, 'sub/file.txt')).not.toThrow()
    await rm(cwd, { recursive: true, force: true })
  })

  it('rejects absolute paths', () => {
    expect(() => assertSafeRelativePath('/tmp', '/etc/passwd')).toThrow(GitError)
  })

  it('rejects parent traversal', () => {
    expect(() => assertSafeRelativePath('/tmp', '../etc/passwd')).toThrow(GitError)
  })
})
