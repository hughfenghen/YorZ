import { createOpencode } from '@opencode-ai/sdk'
import type { OpencodeClient, Message, Part } from '@opencode-ai/sdk'
import { normalizeUsage } from '../telemetry/index.js'
import type {
  AgentDescriptor,
  AgentEvent,
  AgentSdkAdapter,
  AgentSession,
  Capabilities,
  MessagePart,
  NormalizedMessage,
  SendOptions,
  SessionInfo,
} from './types.js'

type Server = { url: string; close(): void }

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
  ) {}

  async *send(prompt: string, opts?: SendOptions): AsyncIterable<AgentEvent> {
    this.aborted = false
    if (opts?.signal?.aborted) return
    opts?.signal?.addEventListener('abort', () => void this.abortInternal(), { once: true })
    try {
      const res = await this.client.session.prompt({
        path: { id: this.id },
        query: { directory: this.directory },
        body: { parts: [{ type: 'text', text: prompt }] },
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
      await this.client.session.abort({ path: { id: this.id } })
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

  async createSession(opts?: { title?: string }): Promise<AgentSession> {
    const { client } = await this.ensure()
    const res = await client.session.create({
      query: { directory: this.cwd },
      body: opts?.title ? { title: opts.title } : {},
    })
    const data = res.data
    if (!data) throw new Error('opencode session.create failed')
    return new OpenCodeSession(data.id, client, this.cwd)
  }

  async resumeSession(id: string): Promise<AgentSession> {
    const { client } = await this.ensure()
    return new OpenCodeSession(id, client, this.cwd)
  }

  async listSessions(): Promise<SessionInfo[]> {
    const { client } = await this.ensure()
    const res = await client.session.list({ query: { directory: this.cwd } })
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
    const res = await client.session.messages({
      path: { id },
      query: { directory: this.cwd },
    })
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
