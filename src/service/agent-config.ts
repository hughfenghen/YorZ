import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type AgentName = 'claude' | 'opencode'

export type AgentStreamFormat = 'json' | 'text'

export interface AgentCmd {
  cmd: string
  args(prompt: string): string[]
  streamFormat: AgentStreamFormat
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
    // `--permission-mode bypassPermissions`：service 拉起 Agent 是后台无人值守
    // 场景，需要它自由完成读写/执行验证命令；-p 非交互模式默认权限会阻塞写
    // 文件与跑命令（典型表现："权限模式阻止了新建目录与文件"）。Agent 工作目
    // 录始终被锁定在项目根，落点也始终在 .yorz/specs/。
    // `--output-format stream-json --verbose`：claude 默认 text 输出会缓冲整段
    // 回复到 exit 前再 flush；stream-json 在每个增量 token/工具事件时立即
    // flush，配合服务端的 JSONL→文本解析后才能真正流式给到 GUI。
    args: (prompt) => [
      '--permission-mode',
      'bypassPermissions',
      '--output-format',
      'stream-json',
      '--verbose',
      '-p',
      prompt,
    ],
    streamFormat: 'json',
  },
  opencode: {
    cmd: 'opencode',
    args: (prompt) => ['-p', prompt],
    streamFormat: 'text',
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
    return { cmd, args: (prompt) => [...prefix, '-p', prompt], streamFormat: 'text' }
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
