import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createOpencode } from '@opencode-ai/sdk'
import type { OpencodeClient, Message, Part } from '@opencode-ai/sdk'
import { normalizeUsage } from '../telemetry/index.js'
import type {
  AgentEvent,
  AgentSdkAdapter,
  AgentSession,
  AgentUsageStatus,
  AgentUsageWindow,
  Capabilities,
  MessagePart,
  NormalizedMessage,
  SendOptions,
  SessionInfo,
} from './types.js'

type Server = { url: string; close(): void }
const execFileP = promisify(execFile)
const OPENCODE_QUOTA_INSTALL = 'npx @slkiser/opencode-quota@latest init'
const OPENCODE_QUOTA_PLUGIN_BIN = join(
  homedir(),
  '.cache',
  'opencode',
  'packages',
  '@slkiser',
  'opencode-quota@latest',
  'node_modules',
  '@slkiser',
  'opencode-quota',
  'dist',
  'bin',
  'opencode-quota.js',
)

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function resetFrom(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return new Date(n * 1000).toISOString()
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }
  const n = numberFrom(value)
  return n == null ? null : new Date(n * 1000).toISOString()
}

function usageWindowFromRecord(rec: Record<string, unknown>, idx: number): AgentUsageWindow | null {
  const label = String(rec.label ?? rec.name ?? rec.title ?? rec.provider ?? `Window ${idx + 1}`)
  const used =
    numberFrom(rec.usedPercent) ??
    numberFrom(rec.used_percent) ??
    numberFrom(rec.percent) ??
    numberFrom(rec.utilization)
  const remaining =
    numberFrom(rec.remainingPercent) ??
    numberFrom(rec.remaining_percent) ??
    numberFrom(rec.percentRemaining)
  const utilization = used ?? (remaining == null ? null : 100 - remaining)
  if (utilization == null) return null
  return {
    key: String(rec.key ?? rec.id ?? label),
    label,
    utilization,
    resetsAt: resetFrom(rec.resetsAt ?? rec.resets_at ?? rec.resetAt ?? rec.reset_at ?? rec.reset),
  }
}

function collectOpencodeQuotaWindows(
  value: unknown,
  out: AgentUsageWindow[],
  seen: Set<unknown>,
): void {
  if (!value || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectOpencodeQuotaWindows(item, out, seen)
    return
  }
  const rec = asRecord(value)
  if (!rec) return
  const win = usageWindowFromRecord(rec, out.length)
  if (win) out.push(win)
  for (const key of ['windows', 'quotas', 'items', 'limits', 'entries']) {
    if (key in rec) collectOpencodeQuotaWindows(rec[key], out, seen)
  }
  for (const key of ['providers', 'data']) {
    const child = asRecord(rec[key])
    if (child) {
      for (const value of Object.values(child)) collectOpencodeQuotaWindows(value, out, seen)
    } else if (key in rec) {
      collectOpencodeQuotaWindows(rec[key], out, seen)
    }
  }
}

export function parseOpencodeQuotaOutput(text: string): AgentUsageStatus | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return parseOpencodeQuotaText(text)
  }
  const windows: AgentUsageWindow[] = []
  collectOpencodeQuotaWindows(raw, windows, new Set())
  if (windows.length === 0) return null
  return {
    kind: 'opencode',
    status: 'available',
    checkedAt: Date.now(),
    source: 'external-cli',
    rateLimitsAvailable: true,
    windows,
  }
}

function parseOpencodeQuotaText(text: string): AgentUsageStatus | null {
  const windows: AgentUsageWindow[] = []
  let provider = ''
  for (const line of text.split('\n')) {
    const providerMatch = line.match(/^\s*→\s*\[(.+?)]/)
    if (providerMatch) {
      provider = providerMatch[1].trim()
      continue
    }
    const quotaMatch = line.match(/^\s*(.+?quota)\s+.*?(\d+(?:\.\d+)?)%\s+left/i)
    if (!quotaMatch) continue
    const label = [provider, quotaMatch[1].trim()].filter(Boolean).join(': ')
    const remaining = Number(quotaMatch[2])
    windows.push({
      key: label || `quota:${windows.length}`,
      label: label || `Quota ${windows.length + 1}`,
      utilization: Math.max(0, Math.min(100, 100 - remaining)),
      resetsAt: null,
    })
  }
  if (windows.length === 0) return null
  return {
    kind: 'opencode',
    status: 'available',
    checkedAt: Date.now(),
    source: 'external-cli',
    rateLimitsAvailable: true,
    windows,
  }
}

async function opencodeQuotaCommands(): Promise<Array<{ cmd: string; args: string[] }>> {
  const commands = [{ cmd: 'opencode-quota', args: ['show', '--json'] }]
  try {
    await access(OPENCODE_QUOTA_PLUGIN_BIN)
    commands.push({ cmd: process.execPath, args: [OPENCODE_QUOTA_PLUGIN_BIN, 'show', '--json'] })
  } catch {
    // Plugin package is not installed in OpenCode's cache.
  }
  return commands
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
  private booting: Promise<{ client: OpencodeClient; server: Server }> | null = null

  constructor(private readonly cwd: string) {}

  private async ensure(): Promise<{ client: OpencodeClient; server: Server }> {
    if (!this.booting) {
      this.booting = createOpencode({ hostname: '127.0.0.1' }).catch((err) => {
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

  capabilities(): Capabilities {
    return { listSessions: true, getMessages: true, usageStatus: true }
  }

  async getUsageStatus(): Promise<AgentUsageStatus> {
    let lastError: unknown
    for (const command of await opencodeQuotaCommands()) {
      try {
        const { stdout } = await execFileP(command.cmd, command.args, {
          cwd: this.cwd,
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
        })
        const parsed = parseOpencodeQuotaOutput(stdout)
        if (parsed) return parsed
        return {
          kind: this.kind,
          status: 'error',
          checkedAt: Date.now(),
          source: 'external-cli',
          message: 'opencode-quota returned no parseable quota windows',
        }
      } catch (err) {
        lastError = err
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
        break
      }
    }
    const err = lastError
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') {
      return {
        kind: this.kind,
        status: 'unavailable',
        checkedAt: Date.now(),
        source: 'external-cli',
        installCommand: OPENCODE_QUOTA_INSTALL,
        message: 'opencode-quota is not installed',
      }
    }
    return {
      kind: this.kind,
      status: 'error',
      checkedAt: Date.now(),
      source: 'external-cli',
      message: err instanceof Error ? err.message : String(err),
    }
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
