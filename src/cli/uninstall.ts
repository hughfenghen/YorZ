import { access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getAdapter } from './adapters/index.js'
import type { AgentName, InstallScope } from './adapters/types.js'
import { SKILL_DIR_NAME } from './install.js'

export interface UninstallOptions {
  agent: AgentName
  scope: InstallScope
  home: string
  cwd: string
}

export interface UninstallResult {
  path: string
  removed: boolean
}

export async function uninstall(opts: UninstallOptions): Promise<UninstallResult> {
  const adapter = getAdapter(opts.agent)
  const baseDir = adapter.resolveSkillsDir(opts.scope, { home: opts.home, cwd: opts.cwd })
  const skillDir = join(baseDir, SKILL_DIR_NAME)

  try {
    await access(skillDir)
  } catch {
    return { path: skillDir, removed: false }
  }

  await rm(skillDir, { recursive: true, force: true })
  return { path: skillDir, removed: true }
}
