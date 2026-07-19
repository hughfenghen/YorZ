import { access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getAdapter } from './adapters/index.js'
import type { AgentName, InstallScope } from './adapters/types.js'
import { SKILL_DIR_NAMES } from './install.js'

export interface UninstallOptions {
  agent: AgentName
  scope: InstallScope
  home: string
  cwd: string
}

export interface UninstallResult {
  skill: string
  path: string
  removed: boolean
}

/** Remove every bundled skill dir ({@link SKILL_DIR_NAMES}) for the given agent. */
export async function uninstall(opts: UninstallOptions): Promise<UninstallResult[]> {
  const adapter = getAdapter(opts.agent)
  const baseDir = adapter.resolveSkillsDir(opts.scope, { home: opts.home, cwd: opts.cwd })
  const results: UninstallResult[] = []
  for (const skill of SKILL_DIR_NAMES) {
    const skillDir = join(baseDir, skill)
    try {
      await access(skillDir)
    } catch {
      results.push({ skill, path: skillDir, removed: false })
      continue
    }
    await rm(skillDir, { recursive: true, force: true })
    results.push({ skill, path: skillDir, removed: true })
  }
  return results
}
