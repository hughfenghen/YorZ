import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAdapter } from './adapters/index.js'
import type { AgentName, InstallScope } from './adapters/types.js'
import { isGitRepo } from './git.js'

export const SKILL_DIR_NAME = 'yorz-spec'

/** Agents that `ensureSkillsInstalled()` keeps up to date (scope=user). */
export const AUTO_INSTALL_AGENTS: AgentName[] = ['claude', 'opencode', 'codex']

// Inline every md/json under src/skill/yorz-spec at build time, but exclude __tests__
// so testing fixtures never get shipped to the user's Claude / OpenCode scope.
const SKILL_FILES = import.meta.glob('../skill/yorz-spec/**/*.{md,json}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const SKILL_PREFIX = '../skill/yorz-spec/'

export interface InstallOptions {
  agent: AgentName
  scope: InstallScope
  home: string
  cwd: string
}

export interface InstallResult {
  /** Path to the main SKILL.md entry. */
  path: string
  /** Whether an existing yorz-spec/ directory was overwritten. */
  overwritten: boolean
  /** All files written, relative paths under the skill dir. */
  files: string[]
  /**
   * Result of the optional `.gitignore` update for `.yorz/tmp`. `null` when
   * `cwd` is not a git repository (no change attempted).
   */
  gitignore: { updated: boolean; path: string } | null
}

interface SkillFile {
  relPath: string
  content: string
}

function resolveSkillFiles(): SkillFile[] {
  const files: SkillFile[] = []
  for (const [key, content] of Object.entries(SKILL_FILES)) {
    const idx = key.indexOf(SKILL_PREFIX)
    if (idx < 0) continue
    const relPath = key.slice(idx + SKILL_PREFIX.length)
    if (!relPath || relPath.startsWith('__tests__/') || relPath.includes('/__tests__/')) continue
    files.push({ relPath, content })
  }
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

export async function install(opts: InstallOptions): Promise<InstallResult> {
  const adapter = getAdapter(opts.agent)
  const baseDir = adapter.resolveSkillsDir(opts.scope, { home: opts.home, cwd: opts.cwd })
  const skillDir = join(baseDir, SKILL_DIR_NAME)
  const entry = join(skillDir, 'SKILL.md')

  const overwritten = await dirExists(skillDir)
  // Wipe only the yorz-spec subdirectory — sibling skills under <baseDir> are untouched.
  await rm(skillDir, { recursive: true, force: true })
  await mkdir(skillDir, { recursive: true })

  const files = resolveSkillFiles()
  if (!files.some((f) => f.relPath === 'SKILL.md')) {
    throw new Error('install: bundled skill files missing SKILL.md entry')
  }
  for (const f of files) {
    const target = join(skillDir, f.relPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, f.content, 'utf8')
  }

  const gitignore = await ensureTmpIgnored(opts.cwd)

  return {
    path: entry,
    overwritten,
    files: files.map((f) => f.relPath),
    gitignore,
  }
}

/**
 * SHA-256 fingerprint of the bundled skill content. Files are sorted by
 * `relPath` (resolveSkillFiles already sorts) and hashed as
 * `relPath + '\0' + content` so any content or file-set change flips the
 * digest — no hand-maintained version number required.
 */
export function computeBundledFingerprint(): string {
  return fingerprintFiles(resolveSkillFiles())
}

/**
 * Fingerprint of an installed skill directory using the same algorithm as
 * {@link computeBundledFingerprint}. Returns `null` when the directory has no
 * `SKILL.md` entry (treated as "not installed").
 */
export async function readInstalledFingerprint(skillDir: string): Promise<string | null> {
  const relPaths = resolveSkillFiles().map((f) => f.relPath)
  if (!relPaths.includes('SKILL.md')) return null
  const files: SkillFile[] = []
  for (const relPath of relPaths) {
    let content: string
    try {
      content = await readFile(join(skillDir, relPath), 'utf8')
    } catch {
      if (relPath === 'SKILL.md') return null
      // A bundled file missing on disk still counts toward the fingerprint as
      // empty, so a partial install reads as "outdated" rather than matching.
      content = ''
    }
    files.push({ relPath, content })
  }
  return fingerprintFiles(files)
}

function fingerprintFiles(files: SkillFile[]): string {
  const hash = createHash('sha256')
  for (const f of [...files].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    hash.update(f.relPath)
    hash.update('\0')
    hash.update(f.content)
    hash.update('\0')
  }
  return hash.digest('hex')
}

export type EnsureStatus = 'installed' | 'updated' | 'up-to-date'

export interface EnsureSkillsResult {
  agent: AgentName
  status: EnsureStatus
  path: string
}

/**
 * Ensure the bundled `yorz-spec` skill is present and current for every
 * auto-install agent at user scope. Installs when missing, re-installs when the
 * installed fingerprint differs from the bundled one, and skips otherwise.
 * Returns one result per agent for the caller (serve) to log.
 */
export async function ensureSkillsInstalled(opts: {
  home: string
  cwd: string
}): Promise<EnsureSkillsResult[]> {
  const bundled = computeBundledFingerprint()
  const results: EnsureSkillsResult[] = []
  for (const agent of AUTO_INSTALL_AGENTS) {
    const adapter = getAdapter(agent)
    const baseDir = adapter.resolveSkillsDir('user', { home: opts.home, cwd: opts.cwd })
    const skillDir = join(baseDir, SKILL_DIR_NAME)
    const entry = join(skillDir, 'SKILL.md')
    const installed = await readInstalledFingerprint(skillDir)

    if (installed === bundled) {
      results.push({ agent, status: 'up-to-date', path: entry })
      continue
    }

    const status: EnsureStatus = installed === null ? 'installed' : 'updated'
    const result = await install({ agent, scope: 'user', home: opts.home, cwd: opts.cwd })
    results.push({ agent, status, path: result.path })
  }
  return results
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}

function hasIgnoreEntry(content: string, target: string): boolean {
  const normalized = target.replace(/\/$/, '')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const cleaned = line.replace(/\/$/, '').replace(/^\//, '')
    if (cleaned === normalized) return true
  }
  return false
}

/**
 * Append `.yorz/tmp` to `<cwd>/.gitignore` when `cwd` is a git repository
 * and the entry isn't already present. Returns `null` when `cwd` is not a
 * git repo (no change attempted).
 */
export async function ensureTmpIgnored(
  cwd: string,
): Promise<{ updated: boolean; path: string } | null> {
  if (!(await isGitRepo(cwd))) return null
  const giPath = join(cwd, '.gitignore')
  let existing = ''
  try {
    existing = await readFile(giPath, 'utf8')
  } catch {
    existing = ''
  }
  if (hasIgnoreEntry(existing, '.yorz/tmp')) {
    return { updated: false, path: giPath }
  }
  const needsNewline = existing.length > 0 && !existing.endsWith('\n')
  const next = `${existing}${needsNewline ? '\n' : ''}.yorz/tmp\n`
  await writeFile(giPath, next, 'utf8')
  return { updated: true, path: giPath }
}
