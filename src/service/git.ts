import { readFile } from 'node:fs/promises'
import { resolve as resolvePath, sep as pathSep } from 'node:path'
import { execFileWithoutWindow } from './process.js'
import { getTelemetry } from './telemetry/index.js'

export interface GitChange {
  path: string
  index: string
  worktree: string
  status: string
  renamedFrom?: string
}

export interface CommitOptions {
  message: string
  paths: string[]
}

export interface DiscardOptions {
  paths: string[]
}

export interface StashOptions {
  message: string
  paths: string[]
}

export interface FileDiff {
  path: string
  /** Unified diff text; empty when there is nothing to show (binary/no change). */
  patch: string
  binary: boolean
  truncated: boolean
}

export interface PartitionedPaths {
  tracked: string[]
  untracked: string[]
  renamed: Array<{ path: string; renamedFrom: string }>
}

export class GitError extends Error {
  readonly code: string
  readonly stderr: string

  constructor(code: string, message: string, stderr = '') {
    super(message)
    this.name = 'GitError'
    this.code = code
    this.stderr = stderr
  }
}

const STATUS_FROM_CODE: Record<string, GitChange['status']> = {
  ' M': 'M',
  'M ': 'M',
  MM: 'M',
  ' A': 'A',
  'A ': 'A',
  AM: 'A',
  ' D': 'D',
  'D ': 'D',
  ' R': 'R',
  'R ': 'R',
  '??': '??',
}

function classifyStatus(index: string, worktree: string): GitChange['status'] {
  const key = `${index}${worktree}`
  if (STATUS_FROM_CODE[key]) return STATUS_FROM_CODE[key]
  if (index === '?' && worktree === '?') return '??'
  if (worktree === 'M') return 'M'
  if (worktree === 'D') return 'D'
  if (index === 'A') return 'A'
  if (index === 'M') return 'M'
  if (index === 'D') return 'D'
  if (index === 'R') return 'R'
  return index === ' ' ? worktree : index
}

/** Reject obviously hostile paths before handing them to `git add`. */
export function assertSafeRelativePath(cwd: string, p: string): string {
  if (typeof p !== 'string' || p.length === 0) {
    throw new GitError('invalid_path', 'path must be a non-empty string')
  }
  if (p.startsWith('/')) {
    throw new GitError('invalid_path', `absolute path not allowed: ${p}`)
  }
  if (p.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new GitError('invalid_path', `parent traversal not allowed: ${p}`)
  }
  const absolute = resolvePath(cwd, p)
  const cwdWithSep = cwd.endsWith(pathSep) ? cwd : `${cwd}${pathSep}`
  if (absolute !== cwd && !absolute.startsWith(cwdWithSep)) {
    throw new GitError('invalid_path', `path escapes cwd: ${p}`)
  }
  return p
}

/**
 * Record one git invocation. Only the subcommand name is kept — arguments
 * carry paths, branch names and commit messages, none of which any planned
 * metric needs.
 */
function recordGitOp(cwd: string, args: string[], startedAt: number, ok: boolean, code?: number) {
  getTelemetry(cwd).record('git.op', {
    op: args[0] ?? 'unknown',
    ok,
    exitCode: code,
    durMs: Date.now() - startedAt,
  })
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const startedAt = Date.now()
  try {
    const result = await execFileWithoutWindow('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    recordGitOp(cwd, args, startedAt, true, 0)
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
    recordGitOp(cwd, args, startedAt, false, typeof e.code === 'number' ? e.code : undefined)
    if (e.code === 'ENOENT') {
      throw new GitError('git_missing', 'git not found on PATH')
    }
    throw new GitError('git_failed', `git ${args[0]} failed`, e.stderr ?? e.message)
  }
}

/**
 * Throwing form of `git` shared with WorktreeManager. Preserves the GitError
 * shape so callers can distinguish missing-git from execution failure.
 */
export async function runGitChecked(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return runGit(cwd, args)
}

/**
 * Non-throwing form for commands where a non-zero exit is meaningful state
 * (e.g. `git merge` conflicting). Returns the exit code along with stdout/stderr.
 */
export async function runGitRaw(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const startedAt = Date.now()
  try {
    const result = await execFileWithoutWindow('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    recordGitOp(cwd, args, startedAt, true, 0)
    return { stdout: result.stdout, stderr: result.stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stderr?: string
      stdout?: string
      code?: number | string
    }
    if (e.code === 'ENOENT') {
      recordGitOp(cwd, args, startedAt, false)
      throw new GitError('git_missing', 'git not found on PATH')
    }
    const code = typeof e.code === 'number' ? e.code : 1
    recordGitOp(cwd, args, startedAt, false, code)
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '', code }
  }
}

export async function listChanges(cwd: string): Promise<GitChange[]> {
  const { stdout } = await runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  return parsePorcelain(stdout)
}

function parsePorcelain(raw: string): GitChange[] {
  const out: GitChange[] = []
  if (!raw) return out
  // Records are NUL-terminated; rename entries are followed by an extra NUL-terminated origin path.
  const records = raw.split('\0')
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!rec) continue
    if (rec.length < 3) continue
    const index = rec[0]
    const worktree = rec[1]
    const path = rec.slice(3)
    const change: GitChange = {
      path,
      index,
      worktree,
      status: classifyStatus(index, worktree),
    }
    if (index === 'R' || worktree === 'R') {
      const from = records[i + 1] ?? ''
      change.renamedFrom = from
      i += 1
    }
    out.push(change)
  }
  return out
}

async function partitionPathsByStatus(cwd: string, paths: string[]): Promise<PartitionedPaths> {
  const all = await listChanges(cwd)
  const byPath = new Map(all.map((c) => [c.path, c]))
  const result: PartitionedPaths = { tracked: [], untracked: [], renamed: [] }
  for (const p of paths) {
    const change = byPath.get(p)
    if (!change) continue
    if (change.status === '??') {
      result.untracked.push(p)
    } else if (change.renamedFrom) {
      result.renamed.push({ path: p, renamedFrom: change.renamedFrom })
    } else {
      result.tracked.push(p)
    }
  }
  return result
}

export async function commit(cwd: string, opts: CommitOptions): Promise<{ commit: string }> {
  const message = opts.message?.trim() ?? ''
  if (!message) throw new GitError('invalid_message', 'commit message must not be empty')
  if (!Array.isArray(opts.paths) || opts.paths.length === 0) {
    throw new GitError('no_paths', 'commit requires at least one path')
  }
  for (const p of opts.paths) assertSafeRelativePath(cwd, p)

  const { renamed } = await partitionPathsByStatus(cwd, opts.paths)
  const extraPaths = renamed.map((r) => r.renamedFrom)
  const allPaths = [...opts.paths, ...extraPaths]

  // Stage first, then commit the index without a pathspec. A pathspec commit
  // (`git commit -- <paths>`) builds a temporary index, so a pre-commit hook
  // that rewrites files (e.g. a formatter) writes into that throwaway index:
  // after the commit the real index and the worktree disagree and the same file
  // shows up as both staged and unstaged with opposite diffs.
  await runGit(cwd, ['add', '--', ...allPaths])
  await runGit(cwd, ['commit', '-m', message])
  const { stdout } = await runGit(cwd, ['rev-parse', 'HEAD'])
  return { commit: stdout.trim() }
}

export async function discard(cwd: string, opts: DiscardOptions): Promise<void> {
  if (!Array.isArray(opts.paths) || opts.paths.length === 0) {
    throw new GitError('no_paths', 'discard requires at least one path')
  }
  for (const p of opts.paths) assertSafeRelativePath(cwd, p)

  const { tracked, untracked, renamed } = await partitionPathsByStatus(cwd, opts.paths)

  if (tracked.length) {
    await runGit(cwd, ['restore', '--staged', '--worktree', '--', ...tracked])
  }
  if (untracked.length) {
    await runGit(cwd, ['clean', '-fd', '--', ...untracked])
  }
  for (const r of renamed) {
    await runGitRaw(cwd, ['reset', '-q', 'HEAD', '--', r.renamedFrom, r.path])
    await runGit(cwd, ['restore', '--worktree', '--', r.renamedFrom])
    await runGit(cwd, ['clean', '-fd', '--', r.path])
  }
}

/** Patches larger than this are cut off — the browser cannot usefully render them. */
const MAX_PATCH_BYTES = 512 * 1024
const MAX_PATCH_LINES = 3000

function truncatePatch(patch: string): { patch: string; truncated: boolean } {
  let text = patch
  let truncated = false
  if (Buffer.byteLength(text, 'utf8') > MAX_PATCH_BYTES) {
    text = text.slice(0, MAX_PATCH_BYTES)
    truncated = true
  }
  const lines = text.split('\n')
  if (lines.length > MAX_PATCH_LINES) {
    text = lines.slice(0, MAX_PATCH_LINES).join('\n')
    truncated = true
  }
  return { patch: text, truncated }
}

/**
 * Synthesise an all-additions patch for an untracked file. `git diff --no-index`
 * against the null device would do the same, but the null device path differs on
 * Windows, so we build the hunk ourselves and keep the code platform-neutral.
 */
async function untrackedDiff(cwd: string, path: string): Promise<FileDiff> {
  let buf: Buffer
  try {
    buf = await readFile(resolvePath(cwd, path))
  } catch {
    // Vanished between `git status` and here — nothing to show.
    return { path, patch: '', binary: false, truncated: false }
  }
  if (buf.subarray(0, 8000).includes(0)) {
    return { path, patch: '', binary: true, truncated: false }
  }
  const text = buf.toString('utf8')
  const lines = text.length === 0 ? [] : text.replace(/\n$/, '').split('\n')
  const body = lines.map((l) => `+${l}`).join('\n')
  const header = `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n`
  const { patch, truncated } = truncatePatch(lines.length ? `${header}${body}` : header)
  return { path, patch, binary: false, truncated }
}

/**
 * Unified diff of a single working-tree path against HEAD (covers both staged
 * and unstaged edits, which is what the review UI shows as one file entry).
 */
export async function fileDiff(cwd: string, path: string): Promise<FileDiff> {
  assertSafeRelativePath(cwd, path)
  const change = (await listChanges(cwd)).find((c) => c.path === path)
  if (change?.status === '??') return untrackedDiff(cwd, path)

  const pathArgs = change?.renamedFrom ? [change.renamedFrom, path] : [path]
  const res = await runGitRaw(cwd, ['diff', 'HEAD', '--', ...pathArgs])
  if (res.code !== 0 && !res.stdout) {
    throw new GitError('git_failed', res.stderr.trim() || 'git diff failed', res.stderr)
  }
  const raw = res.stdout
  if (!raw.includes('@@') && /^Binary files .* differ$/m.test(raw)) {
    return { path, patch: '', binary: true, truncated: false }
  }
  const { patch, truncated } = truncatePatch(raw)
  return { path, patch, binary: false, truncated }
}

export interface GitBranchState {
  current: string
  branches: string[]
}

export async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = stdout.trim()
  if (!branch || branch === 'HEAD') {
    throw new GitError('detached_head', 'cannot operate from a detached HEAD')
  }
  return branch
}

export async function listBranches(cwd: string): Promise<GitBranchState> {
  const [current, branchesResult] = await Promise.all([
    currentBranch(cwd),
    runGit(cwd, ['branch', '--format=%(refname:short)']),
  ])
  const branches = branchesResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return { current, branches }
}

export async function checkoutBranch(cwd: string, branch: string): Promise<{ current: string }> {
  const target = branch?.trim() ?? ''
  if (!target) throw new GitError('invalid_branch', 'branch must not be empty')
  const state = await listBranches(cwd)
  if (!state.branches.includes(target)) {
    throw new GitError('invalid_branch', `unknown local branch: ${target}`)
  }
  if (state.current === target) return { current: state.current }

  const res = await runGitRaw(cwd, ['checkout', target])
  if (res.code !== 0) {
    throw new GitError('checkout_failed', res.stderr.trim() || 'git checkout failed', res.stderr)
  }
  return { current: await currentBranch(cwd) }
}

/**
 * Push the current branch. Never force-pushes; when the branch has no upstream
 * it is published to `origin` under the same name.
 */
export async function push(cwd: string): Promise<{ branch: string; createdUpstream: boolean }> {
  const branch = await currentBranch(cwd)
  const upstream = await runGitRaw(cwd, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ])
  const hasUpstream = upstream.code === 0 && upstream.stdout.trim().length > 0
  const args = hasUpstream ? ['push'] : ['push', '--set-upstream', 'origin', branch]
  const res = await runGitRaw(cwd, args)
  if (res.code !== 0) {
    throw new GitError('push_failed', res.stderr.trim() || 'git push failed', res.stderr)
  }
  return { branch, createdUpstream: !hasUpstream }
}

/**
 * Fast-forward-only pull. A diverged branch fails loudly instead of leaving the
 * worktree in a MERGING state the UI has no way to resolve.
 */
export async function pull(cwd: string): Promise<{ branch: string; updated: boolean }> {
  const branch = await currentBranch(cwd)
  const before = (await runGit(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
  const res = await runGitRaw(cwd, ['pull', '--ff-only'])
  if (res.code !== 0) {
    throw new GitError('pull_failed', res.stderr.trim() || 'git pull failed', res.stderr)
  }
  const after = (await runGit(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
  return { branch, updated: before !== after }
}

export async function stash(cwd: string, opts: StashOptions): Promise<void> {
  if (!Array.isArray(opts.paths) || opts.paths.length === 0) {
    throw new GitError('no_paths', 'stash requires at least one path')
  }
  for (const p of opts.paths) assertSafeRelativePath(cwd, p)

  const { renamed } = await partitionPathsByStatus(cwd, opts.paths)
  const extraPaths = renamed.map((r) => r.renamedFrom)
  const allPaths = [...opts.paths, ...extraPaths]

  const message = opts.message?.trim() || 'yorz:stash'
  await runGit(cwd, ['stash', 'push', '--include-untracked', '-m', message, '--', ...allPaths])
}
