import { join } from 'node:path'
import type { AdapterContext, AgentAdapter, InstallScope } from './types.js'

export const codexAdapter: AgentAdapter = {
  name: 'codex',
  resolveSkillsDir(scope: InstallScope, ctx: AdapterContext): string {
    if (scope === 'user') return join(ctx.home, '.codex', 'skills')
    return join(ctx.cwd, '.codex', 'skills')
  },
}
