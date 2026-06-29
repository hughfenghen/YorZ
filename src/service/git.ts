import { execFile } from 'node:child_process'
import { resolve as resolvePath, sep as pathSep } from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

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

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileP('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
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
  try {
    const result = await execFileP('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    return { stdout: result.stdout, stderr: result.stderr, code: 0 }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stderr?: string
      stdout?: string
      code?: number | string
    }
    if (e.code === 'ENOENT') {
      throw new GitError('git_missing', 'git not found on PATH')
    }
    const code = typeof e.code === 'number' ? e.code : 1
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

export async function commit(cwd: string, opts: CommitOptions): Promise<{ commit: string }> {
  const message = opts.message?.trim() ?? ''
  if (!message) throw new GitError('invalid_message', 'commit message must not be empty')
  if (!Array.isArray(opts.paths) || opts.paths.length === 0) {
    throw new GitError('no_paths', 'commit requires at least one path')
  }
  for (const p of opts.paths) assertSafeRelativePath(cwd, p)

  await runGit(cwd, ['add', '--', ...opts.paths])
  await runGit(cwd, ['commit', '-m', message, '--', ...opts.paths])
  const { stdout } = await runGit(cwd, ['rev-parse', 'HEAD'])
  return { commit: stdout.trim() }
}
