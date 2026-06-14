import { join } from 'node:path'
import type { AdapterContext, AgentAdapter, InstallScope } from './types.js'

export const claudeAdapter: AgentAdapter = {
  name: 'claude',
  resolveSkillsDir(scope: InstallScope, ctx: AdapterContext): string {
    if (scope === 'user') return join(ctx.home, '.claude', 'skills')
    return join(ctx.cwd, '.claude', 'skills')
  },
}
