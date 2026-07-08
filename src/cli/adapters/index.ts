import { claudeAdapter } from './claude.js'
import { codexAdapter } from './codex.js'
import { opencodeAdapter } from './opencode.js'
import type { AgentAdapter, AgentName } from './types.js'

const ADAPTERS: Record<AgentName, AgentAdapter> = {
  claude: claudeAdapter,
  opencode: opencodeAdapter,
  codex: codexAdapter,
}

export function getAdapter(name: string): AgentAdapter {
  if (name in ADAPTERS) return ADAPTERS[name as AgentName]
  throw new Error(`Unknown agent: ${name}. Supported: ${Object.keys(ADAPTERS).join(', ')}`)
}

export type { AgentAdapter, AgentName, InstallScope, AdapterContext } from './types.js'
