import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm, mkdir, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  GitError,
  assertSafeRelativePath,
  commit,
  discard,
  stash,
  listChanges,
  fileDiff,
  push,
  pull,
} from '../git.js'

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

describe('git.discard', () => {
  it('discards mixed tracked + untracked files without error', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'tracked.txt'), 'orig\n', 'utf8')
    await git(cwd, ['add', 'tracked.txt'])
    await git(cwd, ['commit', '-q', '-m', 'seed'])

    await writeFile(join(cwd, 'tracked.txt'), 'changed\n', 'utf8')
    await writeFile(join(cwd, 'untracked.txt'), 'new\n', 'utf8')

    await discard(cwd, { paths: ['tracked.txt', 'untracked.txt'] })

    const status = await listChanges(cwd)
    expect(status.find((c) => c.path === 'tracked.txt')).toBeUndefined()
    expect(status.find((c) => c.path === 'untracked.txt')).toBeUndefined()

    await rm(cwd, { recursive: true, force: true })
  })

  it('discards only untracked files', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'untracked.txt'), 'new\n', 'utf8')

    await discard(cwd, { paths: ['untracked.txt'] })

    const status = await listChanges(cwd)
    expect(status.find((c) => c.path === 'untracked.txt')).toBeUndefined()

    await rm(cwd, { recursive: true, force: true })
  })
})

describe('git.stash', () => {
  it('stashes mixed tracked + untracked files', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'tracked.txt'), 'orig\n', 'utf8')
    await git(cwd, ['add', 'tracked.txt'])
    await git(cwd, ['commit', '-q', '-m', 'seed'])

    await writeFile(join(cwd, 'tracked.txt'), 'changed\n', 'utf8')
    await writeFile(join(cwd, 'untracked.txt'), 'new\n', 'utf8')

    await stash(cwd, { message: 'test-stash', paths: ['tracked.txt', 'untracked.txt'] })

    const status = await listChanges(cwd)
    expect(status.find((c) => c.path === 'tracked.txt')).toBeUndefined()
    expect(status.find((c) => c.path === 'untracked.txt')).toBeUndefined()

    await rm(cwd, { recursive: true, force: true })
  })
})

describe('git.commit mixed states', () => {
  it('commits untracked + unstaged + staged files together', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'existing.txt'), 'orig\n', 'utf8')
    await git(cwd, ['add', 'existing.txt'])
    await git(cwd, ['commit', '-q', '-m', 'seed'])

    await writeFile(join(cwd, 'staged.txt'), 'staged\n', 'utf8')
    await git(cwd, ['add', 'staged.txt'])

    await writeFile(join(cwd, 'existing.txt'), 'modified\n', 'utf8')
    await writeFile(join(cwd, 'untracked.txt'), 'new\n', 'utf8')

    const { commit: sha } = await commit(cwd, {
      message: 'mixed commit',
      paths: ['staged.txt', 'existing.txt', 'untracked.txt'],
    })
    expect(sha).toMatch(/^[0-9a-f]{40}$/)

    const status = await listChanges(cwd)
    expect(status.find((c) => c.path === 'staged.txt')).toBeUndefined()
    expect(status.find((c) => c.path === 'existing.txt')).toBeUndefined()
    expect(status.find((c) => c.path === 'untracked.txt')).toBeUndefined()

    await rm(cwd, { recursive: true, force: true })
  })

  // Regression: a pathspec commit (`git commit -- <paths>`) runs the hook against
  // a temporary index, so a formatting hook's rewrite never lands in the real
  // index and the file ends up both staged and unstaged with opposite diffs.
  it('leaves no staged/unstaged residue when a pre-commit hook rewrites the file', async () => {
    const cwd = await initRepo()
    const hook = join(cwd, '.git', 'hooks', 'pre-commit')
    await writeFile(hook, '#!/bin/sh\nprintf "formatted\\n" > fmt.txt\ngit add fmt.txt\n', 'utf8')
    await chmod(hook, 0o755)

    await writeFile(join(cwd, 'fmt.txt'), 'raw\n', 'utf8')
    await commit(cwd, { message: 'hook rewrite', paths: ['fmt.txt'] })

    // Worktree, index and HEAD must all agree on the hook-formatted content.
    const status = await listChanges(cwd)
    expect(status.filter((c) => c.path === 'fmt.txt')).toEqual([])
    const committed = await git(cwd, ['show', 'HEAD:fmt.txt'])
    expect(committed).toBe('formatted\n')

    await rm(cwd, { recursive: true, force: true })
  })
})

describe('git.fileDiff', () => {
  it('diffs a modified tracked file against HEAD', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'a.txt'), 'one\n', 'utf8')
    await git(cwd, ['add', 'a.txt'])
    await git(cwd, ['commit', '-q', '-m', 'seed'])
    await writeFile(join(cwd, 'a.txt'), 'two\n', 'utf8')

    const diff = await fileDiff(cwd, 'a.txt')
    expect(diff.binary).toBe(false)
    expect(diff.truncated).toBe(false)
    expect(diff.patch).toContain('-one')
    expect(diff.patch).toContain('+two')

    await rm(cwd, { recursive: true, force: true })
  })

  it('covers staged edits too (diff is taken against HEAD)', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'a.txt'), 'one\n', 'utf8')
    await git(cwd, ['add', 'a.txt'])
    await git(cwd, ['commit', '-q', '-m', 'seed'])
    await writeFile(join(cwd, 'a.txt'), 'staged\n', 'utf8')
    await git(cwd, ['add', 'a.txt'])

    const diff = await fileDiff(cwd, 'a.txt')
    expect(diff.patch).toContain('+staged')

    await rm(cwd, { recursive: true, force: true })
  })

  it('renders an untracked file as an all-additions patch', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'new.txt'), 'hello\nworld\n', 'utf8')

    const diff = await fileDiff(cwd, 'new.txt')
    expect(diff.binary).toBe(false)
    expect(diff.patch).toContain('+++ b/new.txt')
    expect(diff.patch).toContain('@@ -0,0 +1,2 @@')
    expect(diff.patch).toContain('+hello')
    expect(diff.patch).toContain('+world')

    await rm(cwd, { recursive: true, force: true })
  })

  it('includes both sides of a rename', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'old.txt'), 'content\n', 'utf8')
    await git(cwd, ['add', 'old.txt'])
    await git(cwd, ['commit', '-q', '-m', 'seed'])
    await git(cwd, ['mv', 'old.txt', 'new.txt'])

    const diff = await fileDiff(cwd, 'new.txt')
    expect(diff.patch).toContain('old.txt')
    expect(diff.patch).toContain('new.txt')

    await rm(cwd, { recursive: true, force: true })
  })

  it('flags binary files instead of dumping bytes', async () => {
    const cwd = await initRepo()
    await writeFile(join(cwd, 'blob.bin'), Buffer.from([0, 1, 2, 0, 3]))

    const diff = await fileDiff(cwd, 'blob.bin')
    expect(diff.binary).toBe(true)
    expect(diff.patch).toBe('')

    await rm(cwd, { recursive: true, force: true })
  })

  it('truncates oversized patches', async () => {
    const cwd = await initRepo()
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')
    await writeFile(join(cwd, 'big.txt'), `${big}\n`, 'utf8')

    const diff = await fileDiff(cwd, 'big.txt')
    expect(diff.truncated).toBe(true)
    expect(diff.patch.split('\n').length).toBeLessThanOrEqual(3000)

    await rm(cwd, { recursive: true, force: true })
  })

  it('rejects paths outside the repository', async () => {
    const cwd = await initRepo()
    await expect(fileDiff(cwd, '../escape.txt')).rejects.toBeInstanceOf(GitError)
    await rm(cwd, { recursive: true, force: true })
  })
})

/** A bare repo on disk stands in for `origin` so push/pull stay offline. */
async function initRepoWithRemote(): Promise<{ cwd: string; remote: string }> {
  const remote = await mkdtemp(join(tmpdir(), 'yorz-git-remote-'))
  await git(remote, ['init', '-q', '--bare', '-b', 'main'])
  const cwd = await initRepo()
  await git(cwd, ['remote', 'add', 'origin', remote])
  return { cwd, remote }
}

describe('git.push', () => {
  it('publishes a branch that has no upstream yet', async () => {
    const { cwd, remote } = await initRepoWithRemote()

    const result = await push(cwd)
    expect(result.branch).toBe('main')
    expect(result.createdUpstream).toBe(true)
    expect(await git(remote, ['rev-parse', 'main'])).toBe(await git(cwd, ['rev-parse', 'HEAD']))

    await rm(cwd, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  })

  it('pushes over an existing upstream without recreating it', async () => {
    const { cwd, remote } = await initRepoWithRemote()
    await push(cwd)
    await writeFile(join(cwd, 'next.txt'), 'next\n', 'utf8')
    await commit(cwd, { message: 'next', paths: ['next.txt'] })

    const result = await push(cwd)
    expect(result.createdUpstream).toBe(false)
    expect(await git(remote, ['rev-parse', 'main'])).toBe(await git(cwd, ['rev-parse', 'HEAD']))

    await rm(cwd, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  })

  it('surfaces a rejected push as GitError with git stderr', async () => {
    const { cwd, remote } = await initRepoWithRemote()
    await push(cwd)
    // Someone else advanced the remote branch.
    const other = await mkdtemp(join(tmpdir(), 'yorz-git-other-'))
    await git(other, ['clone', '-q', remote, 'work'])
    const work = join(other, 'work')
    await git(work, ['config', 'user.email', 'other@example.com'])
    await git(work, ['config', 'user.name', 'Other'])
    await writeFile(join(work, 'remote-only.txt'), 'x\n', 'utf8')
    await git(work, ['add', '.'])
    await git(work, ['commit', '-q', '-m', 'remote side'])
    await git(work, ['push', '-q'])
    // Local makes a diverging commit.
    await writeFile(join(cwd, 'local-only.txt'), 'y\n', 'utf8')
    await commit(cwd, { message: 'local side', paths: ['local-only.txt'] })

    await expect(push(cwd)).rejects.toBeInstanceOf(GitError)

    await rm(cwd, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  })
})

describe('git.pull', () => {
  it('fast-forwards and reports the update', async () => {
    const { cwd, remote } = await initRepoWithRemote()
    await push(cwd)
    const other = await mkdtemp(join(tmpdir(), 'yorz-git-other-'))
    await git(other, ['clone', '-q', remote, 'work'])
    const work = join(other, 'work')
    await git(work, ['config', 'user.email', 'other@example.com'])
    await git(work, ['config', 'user.name', 'Other'])
    await writeFile(join(work, 'from-remote.txt'), 'x\n', 'utf8')
    await git(work, ['add', '.'])
    await git(work, ['commit', '-q', '-m', 'remote side'])
    await git(work, ['push', '-q'])

    const result = await pull(cwd)
    expect(result.branch).toBe('main')
    expect(result.updated).toBe(true)
    expect(await listChanges(cwd)).toEqual([])

    // Nothing new the second time around.
    const again = await pull(cwd)
    expect(again.updated).toBe(false)

    await rm(cwd, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  })

  it('refuses to merge a diverged branch', async () => {
    const { cwd, remote } = await initRepoWithRemote()
    await push(cwd)
    const other = await mkdtemp(join(tmpdir(), 'yorz-git-other-'))
    await git(other, ['clone', '-q', remote, 'work'])
    const work = join(other, 'work')
    await git(work, ['config', 'user.email', 'other@example.com'])
    await git(work, ['config', 'user.name', 'Other'])
    await writeFile(join(work, 'remote-only.txt'), 'x\n', 'utf8')
    await git(work, ['add', '.'])
    await git(work, ['commit', '-q', '-m', 'remote side'])
    await git(work, ['push', '-q'])
    await writeFile(join(cwd, 'local-only.txt'), 'y\n', 'utf8')
    await commit(cwd, { message: 'local side', paths: ['local-only.txt'] })

    await expect(pull(cwd)).rejects.toBeInstanceOf(GitError)
    // --ff-only leaves no merge in progress.
    expect(await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).toContain('main')

    await rm(cwd, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  })
})
