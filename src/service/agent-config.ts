import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type AgentName = 'claude' | 'opencode'

export interface AgentCmd {
  cmd: string
  args(prompt: string): string[]
}

export interface ResolveAgentCmdOptions {
  cwd: string
  /** Test hook: when set, overrides the resolved command path entirely. */
  override?: AgentCmd
  /** Read process.env. Injectable for testing. */
  env?: NodeJS.ProcessEnv
}

const BUILTIN: Record<AgentName, AgentCmd> = {
  claude: {
    cmd: 'claude',
    args: (prompt) => ['-p', prompt],
  },
  opencode: {
    cmd: 'opencode',
    args: (prompt) => ['-p', prompt],
  },
}

export function resolveAgentCmd(opts: ResolveAgentCmdOptions): AgentCmd {
  if (opts.override) return opts.override
  const env = opts.env ?? process.env
  const envCmd = env.YORZ_AGENT_CMD
  if (envCmd && envCmd.trim()) {
    const tokens = envCmd.trim().split(/\s+/)
    const cmd = tokens[0]!
    const prefix = tokens.slice(1)
    return { cmd, args: (prompt) => [...prefix, '-p', prompt] }
  }
  const name = readAgentName(opts.cwd)
  return BUILTIN[name]
}

function readAgentName(cwd: string): AgentName {
  const path = join(cwd, '.yorz', 'config.json')
  if (!existsSync(path)) return 'claude'
  try {
    const raw = readFileSync(path, 'utf8')
    const data = JSON.parse(raw) as { agent?: unknown }
    if (data.agent === 'opencode') return 'opencode'
    if (data.agent === 'claude') return 'claude'
    return 'claude'
  } catch {
    return 'claude'
  }
}
