import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAdapter } from './adapters/index.js'
import type { AgentName, InstallScope } from './adapters/types.js'

export const SKILL_DIR_NAME = 'yorz-spec'

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

  return {
    path: entry,
    overwritten,
    files: files.map((f) => f.relPath),
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises')
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}
