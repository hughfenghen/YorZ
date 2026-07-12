import { ClaudeAdapter } from './claude-adapter.js'
import { CodexAdapter } from './codex-adapter.js'
import { OpenCodeAdapter } from './opencode-adapter.js'
import type { AgentKind, AgentSdkAdapter } from './types.js'

export function createAdapter(kind: AgentKind, cwd: string): AgentSdkAdapter {
  switch (kind) {
    case 'codex':
      return new CodexAdapter(cwd)
    case 'opencode':
      return new OpenCodeAdapter(cwd)
    case 'claude':
    default:
      return new ClaudeAdapter(cwd)
  }
}

/** Per-project adapter cache keyed by agent kind. */
export class AdapterRegistry {
  private readonly byKind = new Map<AgentKind, AgentSdkAdapter>()
  constructor(private readonly cwd: string) {}

  get(kind: AgentKind): AgentSdkAdapter {
    let a = this.byKind.get(kind)
    if (!a) {
      a = createAdapter(kind, this.cwd)
      this.byKind.set(kind, a)
    }
    return a
  }

  async dispose(): Promise<void> {
    for (const a of this.byKind.values()) {
      if (a.dispose) await a.dispose().catch(() => {})
    }
    this.byKind.clear()
  }
}
