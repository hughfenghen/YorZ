import { access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveGlobalSkillsDir } from '../service/global-config.js'
import { SKILL_DIR_NAMES } from './install.js'

export interface UninstallOptions {
  /** Override for the shared skills dir; resolved from env when omitted. */
  skillsDir?: string
}

export interface UninstallResult {
  skill: string
  path: string
  removed: boolean
}

/** Remove every bundled skill dir ({@link SKILL_DIR_NAMES}) from the shared skills dir. */
export async function uninstall(opts: UninstallOptions = {}): Promise<UninstallResult[]> {
  const baseDir = opts.skillsDir ?? resolveGlobalSkillsDir()
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
