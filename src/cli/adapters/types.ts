export type AgentName = 'claude' | 'opencode'
export type InstallScope = 'user' | 'project'

export interface AdapterContext {
  home: string
  cwd: string
}

export interface AgentAdapter {
  name: AgentName
  resolveSkillsDir(scope: InstallScope, ctx: AdapterContext): string
}
