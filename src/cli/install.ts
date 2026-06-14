import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import skillContent from '../skill/SKILL.md?raw'
import { getAdapter } from './adapters/index.js'
import type { AgentName, InstallScope } from './adapters/types.js'

export const SKILL_DIR_NAME = 'yorz-spec'

export interface InstallOptions {
  agent: AgentName
  scope: InstallScope
  home: string
  cwd: string
}

export interface InstallResult {
  path: string
  overwritten: boolean
}

export async function install(opts: InstallOptions): Promise<InstallResult> {
  const adapter = getAdapter(opts.agent)
  const baseDir = adapter.resolveSkillsDir(opts.scope, { home: opts.home, cwd: opts.cwd })
  const skillDir = join(baseDir, SKILL_DIR_NAME)
  const target = join(skillDir, 'SKILL.md')

  const overwritten = await fileExists(target)
  await mkdir(skillDir, { recursive: true })
  await writeFile(target, skillContent, 'utf8')

  return { path: target, overwritten }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises')
    await access(path)
    return true
  } catch {
    return false
  }
}
