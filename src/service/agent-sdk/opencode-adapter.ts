import { createOpencode } from '@opencode-ai/sdk/v2'
import type { OpencodeClient, Message, Part, Provider } from '@opencode-ai/sdk/v2'
import { normalizeUsage } from '../telemetry/index.js'
import type {
  AgentDescriptor,
  AgentEvent,
  AgentModelCatalog,
  AgentRuntimeConfig,
  AgentSdkAdapter,
  AgentSession,
  Capabilities,
  MessagePart,
  NormalizedMessage,
  SendOptions,
  SessionInfo,
} from './types.js'

type Server = { url: string; close(): void }

export function parseQualifiedModel(
  value: string | undefined,
): { providerID: string; modelID: string } | undefined {
  if (!value) return undefined
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) }
}

export function parseOpenCodeModelCatalog(
  data: { all: Provider[]; connected: string[] } | undefined,
): AgentModelCatalog {
  if (!data) return { models: [], defaultReasoningEfforts: [] }
  const connected = new Set(data.connected)
  const models = data.all
    .filter((provider) => connected.has(provider.id))
    .flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        id: `${provider.id}/${model.id}`,
        displayName: `${provider.name} · ${model.name || model.id}`,
        reasoningEfforts: Object.keys(model.variants ?? {}).map((id) => ({
          id,
          displayName: id,
        })),
      })),
    )
  return { models, defaultReasoningEfforts: [] }
}

function textParts(parts: Part[]): MessagePart[] {
  const out: MessagePart[] = []
  for (const p of parts) {
    if (p.type === 'text' && typeof p.text === 'string' && p.text) {
      out.push({ type: 'text', text: p.text })
    }
  }
  return out
}

class OpenCodeSession implements AgentSession {
  private aborted = false
  constructor(
    public readonly id: string,
    private readonly client: OpencodeClient,
    private readonly directory: string,
    private readonly runtime: AgentRuntimeConfig = {},
  ) {}

  async *send(prompt: string, opts?: SendOptions): AsyncIterable<AgentEvent> {
    this.aborted = false
    if (opts?.signal?.aborted) return
    opts?.signal?.addEventListener('abort', () => void this.abortInternal(), { once: true })
    try {
      const model = parseQualifiedModel(this.runtime.model)
      const res = await this.client.session.prompt({
        sessionID: this.id,
        directory: this.directory,
        parts: [{ type: 'text', text: prompt }],
        ...(model ? { model } : {}),
        ...(this.runtime.reasoningEffort ? { variant: this.runtime.reasoningEffort } : {}),
      })
      if (this.aborted) return
      const data = res.data
      if (!data) {
        const errMsg =
          res.error && typeof res.error === 'object' && 'data' in res.error
            ? String(
                (res.error as { data?: { message?: unknown } }).data?.message ?? 'prompt failed',
              )
            : 'prompt failed'
        yield { type: 'error', message: errMsg }
        return
      }
      for (const part of textParts(data.parts)) {
        if (part.type === 'text') yield { type: 'text', delta: part.text }
      }
      yield {
        type: 'turn-completed',
        usage: data.info.tokens,
        metrics: {
          usage: normalizeUsage('opencode', data.info.tokens),
          model: typeof data.info.modelID === 'string' ? data.info.modelID : undefined,
        },
      }
    } catch (err) {
      if (this.aborted) return
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }

  private async abortInternal(): Promise<void> {
    this.aborted = true
    try {
      await this.client.session.abort({ sessionID: this.id, directory: this.directory })
    } catch {
      // best-effort
    }
  }

  abort(): void {
    void this.abortInternal()
  }
}

export class OpenCodeAdapter implements AgentSdkAdapter {
  readonly kind = 'opencode' as const
  readonly descriptor: AgentDescriptor = {
    id: 'opencode',
    displayName: 'OpenCode',
    source: 'builtin',
    capabilities: { listSessions: true, getMessages: true, usageStatus: false },
  }
  private booting: Promise<{ client: OpencodeClient; server: Server }> | null = null

  constructor(private readonly cwd: string) {}

  private async ensure(): Promise<{ client: OpencodeClient; server: Server }> {
    if (!this.booting) {
      // port 0 lets the OS pick a free port; the SDK resolves the actual URL
      // from the server's "listening on" stdout line. A fixed port would clash
      // with any other running opencode instance (default 4096).
      this.booting = createOpencode({
        hostname: '127.0.0.1',
        port: 0,
        config: {
          permission: {
            edit: 'allow',
            bash: 'allow',
            webfetch: 'allow',
            doom_loop: 'allow',
            external_directory: 'allow',
          },
        },
      }).catch((err) => {
        this.booting = null
        throw err
      })
    }
    return this.booting
  }

  async createSession(opts?: { title?: string } & AgentRuntimeConfig): Promise<AgentSession> {
    const { client } = await this.ensure()
    const res = await client.session.create({
      directory: this.cwd,
      ...(opts?.title ? { title: opts.title } : {}),
    })
    const data = res.data
    if (!data) throw new Error('opencode session.create failed')
    return new OpenCodeSession(data.id, client, this.cwd, opts)
  }

  async resumeSession(id: string, runtime?: AgentRuntimeConfig): Promise<AgentSession> {
    const { client } = await this.ensure()
    return new OpenCodeSession(id, client, this.cwd, runtime)
  }

  async listSessions(): Promise<SessionInfo[]> {
    const { client } = await this.ensure()
    const res = await client.session.list({ directory: this.cwd })
    const list = res.data ?? []
    return list.map((s) => ({
      id: s.id,
      title: s.title || s.id,
      kind: this.kind,
      createdAt: s.time.created,
      updatedAt: s.time.updated,
    }))
  }

  async getMessages(id: string): Promise<NormalizedMessage[]> {
    const { client } = await this.ensure()
    const res = await client.session.messages({ sessionID: id, directory: this.cwd })
    const rows = res.data ?? []
    const out: NormalizedMessage[] = []
    for (const row of rows) {
      const role = (row.info as Message).role
      if (role !== 'user' && role !== 'assistant') continue
      const parts = textParts(row.parts)
      if (parts.length) out.push({ role, parts, ts: row.info.time.created })
    }
    return out
  }

  /**
   * `usageStatus: false` —— opencode 自身没有配额查询接口，早先那条路径是去调
   * 第三方 opencode-quota 插件；实测装了也拿不到可用数据，只会在空态里留下一行
   * 「去装插件」的噪音。与其留一个必然失败的探测（每次还要 spawn 一个 10s 超时
   * 的子进程），不如明确声明不支持：前端据此什么都不显示。
   */
  capabilities(): Capabilities {
    return this.descriptor.capabilities
  }

  async listModels(): Promise<AgentModelCatalog> {
    const { client } = await this.ensure()
    const res = await client.provider.list({ directory: this.cwd })
    return parseOpenCodeModelCatalog(res.data)
  }

  async dispose(): Promise<void> {
    if (!this.booting) return
    try {
      const { server } = await this.booting
      server.close()
    } catch {
      // best-effort
    }
    this.booting = null
  }
}
