import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAdapter } from './adapters/index.js'
import type { AgentName, InstallScope } from './adapters/types.js'
import { isGitRepo } from './git.js'

/** Primary skill dir name; kept as the default for single-skill APIs. */
export const SKILL_DIR_NAME = 'yorz-spec'

/**
 * Every bundled skill directory under `src/skill/`. `ensureSkillsInstalled()`
 * installs/updates each one for every auto-install agent. Add a new skill here
 * (and create `src/skill/<name>/SKILL.md`) to ship it.
 */
export const SKILL_DIR_NAMES: readonly string[] = ['yorz-spec', 'yorz-debug']

/** Agents that `ensureSkillsInstalled()` keeps up to date (scope=user). */
export const AUTO_INSTALL_AGENTS: AgentName[] = ['claude', 'opencode', 'codex']

// Inline every md/json under src/skill/** at build time. Per-skill filtering
// happens in resolveSkillFiles(); __tests__ fixtures are excluded there so they
// never get shipped to the user's Claude / OpenCode scope.
const SKILL_FILES = import.meta.glob('../skill/**/*.{md,json}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const SKILL_ROOT = '../skill/'

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

function resolveSkillFiles(skillDir: string = SKILL_DIR_NAME): SkillFile[] {
  const prefix = `${SKILL_ROOT}${skillDir}/`
  const files: SkillFile[] = []
  for (const [key, content] of Object.entries(SKILL_FILES)) {
    const idx = key.indexOf(prefix)
    if (idx < 0) continue
    const relPath = key.slice(idx + prefix.length)
    if (!relPath || relPath.startsWith('__tests__/') || relPath.includes('/__tests__/')) continue
    files.push({ relPath, content })
  }
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

export async function install(
  opts: InstallOptions,
  skillName: string = SKILL_DIR_NAME,
): Promise<InstallResult> {
  const adapter = getAdapter(opts.agent)
  const baseDir = adapter.resolveSkillsDir(opts.scope, { home: opts.home, cwd: opts.cwd })
  const skillDir = join(baseDir, skillName)
  const entry = join(skillDir, 'SKILL.md')

  const overwritten = await dirExists(skillDir)
  // Wipe only this skill's subdirectory — sibling skills under <baseDir> are untouched.
  await rm(skillDir, { recursive: true, force: true })
  await mkdir(skillDir, { recursive: true })

  const files = resolveSkillFiles(skillName)
  if (!files.some((f) => f.relPath === 'SKILL.md')) {
    throw new Error(`install: bundled skill "${skillName}" missing SKILL.md entry`)
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
export function computeBundledFingerprint(skillName: string = SKILL_DIR_NAME): string {
  return fingerprintFiles(resolveSkillFiles(skillName))
}

/**
 * Fingerprint of an installed skill directory using the same algorithm as
 * {@link computeBundledFingerprint}. Returns `null` when the directory has no
 * `SKILL.md` entry (treated as "not installed").
 */
export async function readInstalledFingerprint(
  skillDir: string,
  skillName: string = SKILL_DIR_NAME,
): Promise<string | null> {
  const relPaths = resolveSkillFiles(skillName).map((f) => f.relPath)
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
  skill: string
  status: EnsureStatus
  path: string
}

/**
 * Ensure every bundled skill ({@link SKILL_DIR_NAMES}) is present and current
 * for every auto-install agent at user scope. Installs when missing, re-installs
 * when the installed fingerprint differs from the bundled one, and skips
 * otherwise. Returns one result per (agent, skill) for the caller (serve) to log.
 */
export async function ensureSkillsInstalled(opts: {
  home: string
  cwd: string
}): Promise<EnsureSkillsResult[]> {
  const results: EnsureSkillsResult[] = []
  for (const agent of AUTO_INSTALL_AGENTS) {
    const adapter = getAdapter(agent)
    const baseDir = adapter.resolveSkillsDir('user', { home: opts.home, cwd: opts.cwd })
    for (const skill of SKILL_DIR_NAMES) {
      const skillDir = join(baseDir, skill)
      const entry = join(skillDir, 'SKILL.md')
      const bundled = computeBundledFingerprint(skill)
      const installed = await readInstalledFingerprint(skillDir, skill)

      if (installed === bundled) {
        results.push({ agent, skill, status: 'up-to-date', path: entry })
        continue
      }

      const status: EnsureStatus = installed === null ? 'installed' : 'updated'
      const result = await install({ agent, scope: 'user', home: opts.home, cwd: opts.cwd }, skill)
      results.push({ agent, skill, status, path: result.path })
    }
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
