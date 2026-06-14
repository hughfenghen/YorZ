import { join } from 'node:path'
import type { AdapterContext, AgentAdapter, InstallScope } from './types.js'

export const opencodeAdapter: AgentAdapter = {
  name: 'opencode',
  resolveSkillsDir(scope: InstallScope, ctx: AdapterContext): string {
    if (scope === 'user') return join(ctx.home, '.config', 'opencode', 'skills')
    return join(ctx.cwd, '.opencode', 'skills')
  },
}
