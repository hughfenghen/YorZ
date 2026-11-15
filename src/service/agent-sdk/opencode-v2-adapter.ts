import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { spawnWithoutWindow } from '../process.js'
import { normalizeUsage } from '../telemetry/index.js'
import { probeOpencodeGeneration, type OpencodeGeneration } from './opencode-binary.js'
import type {
  AgentDescriptor,
  AgentEvent,
  AgentModelCatalog,
  AgentModelOption,
  AgentRuntimeConfig,
  AgentSdkAdapter,
  AgentSession,
  Capabilities,
  MessagePart,
  NormalizedMessage,
  SendOptions,
  SessionInfo,
} from './types.js'

/**
 * OpenCode **V2** 适配器。
 *
 * ## 为什么没有用 `@opencode-ai/sdk/v2`
 *
 * 官方 SDK 确实提供了 `/v2` 子路径，但它描述的是 opencode **1.19.x** 线的实验性
 * `/api/*` 接口，而不是 opencode 2.x 服务端的接口。实测（opencode 2.3.0）四处
 * 全部对不上：
 *
 * | 场景 | SDK `@opencode-ai/sdk/v2` | opencode 2.x 实测 |
 * | --- | --- | --- |
 * | 提交 prompt 的 body | `{ prompt: { text } }` | `{ text }`（嵌套写法直接 400） |
 * | 事件流端点 | `GET /api/session/{id}/event` | 404；真实端点是全局 `GET /api/event` |
 * | 事件名 | `session.next.text.ended` 等 | `session.text.delta` / `session.step.ended` 等 |
 * | 消息结构 | `{ info, parts[] }` | `{ type:'user', text }` / `{ type:'assistant', content[] }` |
 *
 * SDK 的启动器同样不兼容：它只认 `opencode server listening` 这一行输出，而 2.x
 * CLI 打印的是 `server listening on <url>`，并且默认开启鉴权（Basic
 * `opencode:<password>`），SDK 客户端没有任何传入密码的入口。因此这里按 2.x 的
 * 真实协议手写一层薄客户端，不引入 `@opencode-ai/sdk`。
 *
 * 协议参考见 opencode 官方发布的 `@opencode/protocol`（2.3.0），那是一份基于
 * Effect Schema 的服务端协议定义；本文件只取其中 HTTP 层的形状，不引入 Effect
 * 运行时。
 */

// ---------------------------------------------------------------------------
// 线上数据结构（只声明用到的字段，其余一律忽略）
// ---------------------------------------------------------------------------

interface V2Tokens {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

interface V2ModelInfo {
  id: string
  providerID: string
  name?: string
  variants?: Array<{ id: string }>
  enabled?: boolean
  status?: string
}

interface V2SessionInfo {
  id: string
  title?: string
  cost?: number
  tokens?: V2Tokens
  time?: { created?: number; updated?: number }
  location?: { directory?: string }
}

interface V2ContentPart {
  type: string
  text?: string
  id?: string
  name?: string
  state?: {
    status?: string
    input?: unknown
    content?: Array<{ type: string; text?: string }>
    error?: { type?: string; message?: string }
  }
}

interface V2Message {
  id: string
  type: string
  time?: { created?: number }
  /** user 消息把正文平铺在 `text` 上。 */
  text?: string
  agent?: string
  model?: { id?: string; providerID?: string }
  content?: V2ContentPart[]
  finish?: string
  cost?: number
  tokens?: V2Tokens
}

interface V2Event {
  id?: string
  type: string
  data?: Record<string, unknown>
}

/** 一条事件的负载，按 opencode 2.x 的实际字段名索引。 */
type EventData = Record<string, unknown>

// ---------------------------------------------------------------------------
// CLI 定位
// ---------------------------------------------------------------------------

/** 桌面包内置 CLI 的安装目录（每个版本一个子目录）。 */
function desktopCliDir(): string {
  return join(homedir(), 'Library', 'Application Support', 'ai.opencode.desktop', 'cli')
}

/**
 * 桌面版（v2）自带的 CLI。它按版本号分目录存放，取版本号最大的一个。
 */
function findDesktopCli(): string | undefined {
  const root = desktopCliDir()
  if (!existsSync(root)) return undefined
  let best: { version: string; file: string } | undefined
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    for (const name of ['opencode-cli', 'opencode.exe', 'opencode']) {
      const file = join(dir, name)
      if (!existsSync(file)) continue
      // 版本号形如 `2.3.0-arm64`，按字符串倒序比较即可近似取最新。
      if (!best || entry.name > best.version) best = { version: entry.name, file }
      break
    }
  }
  return best?.file
}

/**
 * 作为可选依赖安装的 `@opencode/cli`。它把二进制统一放在 `bin/opencode.exe`
 * （各平台同名），平台差异由 `@opencode/cli-<platform>` 可选依赖承担。
 */
function findPackagedCli(): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require.resolve('@opencode/cli/package.json')
    const file = join(dirname(pkg), 'bin', 'opencode.exe')
    return existsSync(file) ? file : undefined
  } catch {
    return undefined
  }
}

/**
 * 依次尝试：显式环境变量 → 可选依赖 → 桌面版内置 → PATH 上的 `opencode2`。
 *
 * `opencode2` 是 npm 包为 v2 准备的 bin 别名，与 v1 的 `opencode` 区分开，
 * 避免误起一个只提供 v1 接口的旧服务端。
 *
 * 自动发现的候选都会用 `--version` 验一次身：可选依赖的二进制是由 postinstall
 * 脚本从平台包拷过去的，脚本被跳过时会留下一份只会打印「postinstall script was
 * not run」的占位文件；这时应该退回桌面版那份。显式指定（环境变量）的不探测，
 * 用户既然点了名就照用。
 */
export async function resolveOpenCodeV2Cli(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  probe: (file: string) => Promise<OpencodeGeneration> = probeOpencodeGeneration,
): Promise<string | undefined> {
  const explicit = env.OPENCODE_V2_CLI?.trim()
  if (explicit && existsSync(explicit)) return explicit
  const candidates: string[] = []
  const packaged = findPackagedCli()
  if (packaged) candidates.push(packaged)
  const desktop = findDesktopCli()
  if (desktop) candidates.push(desktop)
  // PATH 兜底：`opencode2` 由 `@opencode/cli` 提供。
  const bin = platform === 'win32' ? 'opencode2.exe' : 'opencode2'
  for (const dir of (env.PATH ?? '').split(platform === 'win32' ? ';' : ':')) {
    if (!dir) continue
    const file = join(dir, bin)
    if (existsSync(file)) candidates.push(file)
  }
  if (candidates.length === 0) return undefined
  for (const candidate of candidates) {
    if ((await probe(candidate)) === 'v2') return candidate
  }
  // 一个都验不过：仍然返回第一个，让调用方的报错信息包含真实原因。
  return candidates[0]
}

// ---------------------------------------------------------------------------
// 服务端进程
// ---------------------------------------------------------------------------

const SERVER_BOOT_TIMEOUT_MS = 30_000

/**
 * opencode 2.x 的本地服务端。
 *
 * 与 1.x 的两处差异决定了这里不能复用官方 SDK 的启动器：输出格式不同（见上），
 * 且默认开启 Basic 鉴权。这里直接给自己生成一个密码写进
 * `OPENCODE_SERVER_PASSWORD`，这样密码不依赖 stdout 解析（解析只作为兜底）。
 */
export class OpenCodeV2Server {
  private constructor(
    readonly url: string,
    readonly password: string,
    private readonly proc: ChildProcess,
  ) {}

  static async start(cli: string, opts?: { timeoutMs?: number }): Promise<OpenCodeV2Server> {
    const password = randomBytes(24).toString('base64url')
    const proc = spawnWithoutWindow(cli, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
      env: {
        ...process.env,
        OPENCODE_SERVER_PASSWORD: password,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let settled = false
    let output = ''
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        proc.kill()
        reject(
          new Error(
            `opencode v2 服务端启动超时（${opts?.timeoutMs ?? SERVER_BOOT_TIMEOUT_MS}ms）\n${output}`,
          ),
        )
      }, opts?.timeoutMs ?? SERVER_BOOT_TIMEOUT_MS)

      const onData = (chunk: Buffer) => {
        if (settled) return
        output += chunk.toString()
        // 2.x 打印 `server listening on <url>`；`server password <pw>` 只在
        // 没有预设密码时出现，这里只作兜底。
        const match = output.match(/server listening on\s+(https?:\/\/\S+)/)
        if (!match) return
        settled = true
        clearTimeout(timer)
        cleanup()
        resolve(match[1])
      }
      const onExit = (code: number | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cleanup()
        reject(new Error(`opencode v2 服务端退出（code=${code ?? 'null'}）\n${output}`))
      }
      const onError = (err: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        proc.stdout?.off('data', onData)
        proc.stderr?.off('data', onData)
        proc.off('exit', onExit)
        proc.off('error', onError)
      }

      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onData)
      proc.on('exit', onExit)
      proc.on('error', onError)
    })

    return new OpenCodeV2Server(url, password, proc)
  }

  close(): void {
    this.proc.kill()
  }
}

// ---------------------------------------------------------------------------
// HTTP 客户端
// ---------------------------------------------------------------------------

/** 2.x 全部业务端点都要求 Basic 鉴权，账号名固定为 `opencode`。 */
function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
}

class V2Http {
  constructor(
    readonly baseUrl: string,
    private readonly password: string,
    private readonly directory: string,
  ) {}

  headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: basicAuth(this.password),
      // 2.x 用请求头指定工作目录；服务端会把它并入 session 的 location。
      'x-opencode-directory': encodeURIComponent(this.directory),
      ...extra,
    }
  }

  async json<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
    const { json, ...rest } = init ?? {}
    const res = await fetch(this.baseUrl + path, {
      ...rest,
      headers: this.headers({
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      }),
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`opencode v2 ${path} 失败（${res.status}）${text ? `: ${text}` : ''}`)
    }
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error(`opencode v2 ${path} 返回了非 JSON 内容：${text.slice(0, 120)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// 事件总线
// ---------------------------------------------------------------------------

type EventHandler = (event: V2Event) => void

/**
 * 全局 SSE 事件流。
 *
 * 2.x 只有一条全局事件流（`GET /api/event`），没有 1.x 那种按 session 订阅的
 * 端点；所有 session 的事件都混在这条流里，由订阅方按 `sessionID` 过滤。
 */
class V2EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>()
  private controller: AbortController | null = null
  private running: Promise<void> | null = null
  private disposed = false

  constructor(
    private readonly http: V2Http,
    private readonly onError?: (err: unknown) => void,
  ) {}

  /** 订阅某个 session 的事件；返回取消订阅函数。 */
  subscribe(sessionID: string, handler: EventHandler): () => void {
    let set = this.handlers.get(sessionID)
    if (!set) {
      set = new Set()
      this.handlers.set(sessionID, set)
    }
    set.add(handler)
    this.ensure()
    return () => {
      set.delete(handler)
      if (set.size === 0) this.handlers.delete(sessionID)
    }
  }

  private ensure(): void {
    if (this.running || this.disposed) return
    this.running = this.loop().finally(() => {
      this.running = null
      // 连接断开后如果还有订阅者，继续重连。
      if (!this.disposed && this.handlers.size > 0) {
        setTimeout(() => this.ensure(), 1000)
      }
    })
  }

  private async loop(): Promise<void> {
    while (!this.disposed) {
      const controller = new AbortController()
      this.controller = controller
      try {
        const res = await fetch(this.http.baseUrl + '/api/event', {
          headers: this.http.headers(),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`事件流建立失败（${res.status}）`)
        await this.consume(res.body, controller.signal)
      } catch (err) {
        if (this.disposed) return
        this.onError?.(err)
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      if (this.disposed) return
      // 服务端正常收流后断开：退避后重连。
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  private async consume(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader()
    // 手动解码而不是 `TextDecoderStream`：后者在 Node 类型里是 web-streams 版本，
    // 与 `ReadableStream<Uint8Array>` 的类型对不上，而本项目的 lib 只开了 ES2022。
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        for (const line of chunk.split('\n')) {
          // `: heartbeat` 之类的注释行直接跳过。
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload) continue
          let event: V2Event
          try {
            event = JSON.parse(payload) as V2Event
          } catch {
            continue
          }
          this.dispatch(event)
        }
      }
      if (signal.aborted) return
    }
  }

  private dispatch(event: V2Event): void {
    const sessionID = str(event.data?.sessionID)
    if (!sessionID) return
    const set = this.handlers.get(sessionID)
    if (!set) return
    for (const handler of set) {
      try {
        handler(event)
      } catch {
        // 单个订阅者出错不应影响其它订阅者。
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.controller?.abort()
    this.handlers.clear()
  }
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** 把 `providerID/modelID` 拆成二元组；模型 id 自身可以含斜杠。 */
export function parseQualifiedModel(
  value: string | undefined,
): { providerID: string; modelID: string } | undefined {
  if (!value) return undefined
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) }
}

/**
 * 工具结果正文：2.x 把它放在 `data.content` 的 text 分片里（`tool.success` /
 * `tool.failed`），没有扁平的 `output` / `text` 字段。
 */
function toolContentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const texts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const item = part as { type?: unknown; text?: unknown }
    if (item.type === 'text' && typeof item.text === 'string' && item.text) texts.push(item.text)
  }
  return texts.join('\n')
}

/** 事件负载里的错误信息：2.x 用 `error.message`（对象），不是字符串。 */
function eventErrorMessage(data: EventData): string | undefined {
  const error = data.error
  if (error && typeof error === 'object') {
    const message = str((error as { message?: unknown }).message)
    if (message) return message
  }
  return str(error) ?? str(data.message)
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

/** 一次 turn 期间的事件缓冲：把推送式事件转成异步迭代。 */
class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private closed = false
  private notify: (() => void) | null = null

  push(item: T): void {
    if (this.closed) return
    this.items.push(item)
    this.notify?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.notify?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      while (this.items.length > 0) {
        yield this.items.shift() as T
      }
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.notify = resolve
      })
      this.notify = null
    }
  }
}

class OpenCodeV2Session implements AgentSession {
  private aborted = false

  constructor(
    public readonly id: string,
    private readonly adapter: OpenCodeV2Adapter,
    private readonly runtime: AgentRuntimeConfig = {},
  ) {}

  async *send(prompt: string, opts?: SendOptions): AsyncIterable<AgentEvent> {
    this.aborted = false
    if (opts?.signal?.aborted) return
    opts?.signal?.addEventListener('abort', () => void this.abortInternal(), { once: true })

    const bus = await this.adapter.ensureEvents()
    const queue = new AsyncQueue<AgentEvent>()

    let turnFinished = false
    let usage: V2Tokens | undefined
    let modelID: string | undefined
    let lastStepError: string | undefined
    /** tool call id → 工具名（`tool.input.started` 才有 name，`tool.called` 没有）。 */
    const toolNames = new Map<string, string>()
    /** `assistantMessageID#ordinal` → 已经流出去的字符数，用于 `text.ended` 补齐。 */
    const streamedText = new Map<string, number>()

    // 2.x 的用量分两层：`step.ended.tokens` 是**本步**的，`usage.updated.tokens` 是
    // **会话累计**的。一次 turn 由多个 step 组成，所以本轮用量要把各步相加。
    const addUsage = (tokens: V2Tokens | undefined) => {
      if (!tokens) return
      usage = {
        input: (usage?.input ?? 0) + (tokens.input ?? 0),
        output: (usage?.output ?? 0) + (tokens.output ?? 0),
        reasoning: (usage?.reasoning ?? 0) + (tokens.reasoning ?? 0),
        cache: {
          read: (usage?.cache?.read ?? 0) + (tokens.cache?.read ?? 0),
          write: (usage?.cache?.write ?? 0) + (tokens.cache?.write ?? 0),
        },
      }
    }

    const textKey = (data: EventData): string => {
      const id = str(data.assistantMessageID) ?? ''
      const ordinal = typeof data.ordinal === 'number' ? data.ordinal : 0
      return `${id}#${ordinal}`
    }

    const finish = () => {
      if (turnFinished) return
      turnFinished = true
      queue.close()
    }

    const unsubscribe = bus.subscribe(this.id, (event) => {
      const data = event.data ?? {}
      switch (event.type) {
        case 'session.text.delta': {
          const delta = str(data.delta)
          if (!delta) break
          const key = textKey(data)
          streamedText.set(key, (streamedText.get(key) ?? 0) + delta.length)
          queue.push({ type: 'text', delta })
          break
        }
        case 'session.text.ended': {
          // `text.delta` 是 ephemeral 事件（断线即丢），`text.ended` 是 durable 且带
          // 整段正文。它排在 delta 之后：补发「还没流过」的尾巴，既不重复也能救回
          // 不流式（没有 delta）或中途断流的回复。
          const text = str(data.text)
          if (!text) break
          const key = textKey(data)
          const shown = streamedText.get(key) ?? 0
          if (text.length > shown) queue.push({ type: 'text', delta: text.slice(shown) })
          streamedText.set(key, text.length)
          break
        }
        case 'session.tool.input.started': {
          const id = str(data.id)
          const name = str(data.name)
          if (id && name) toolNames.set(id, name)
          break
        }
        case 'session.tool.called': {
          const id = str(data.id)
          queue.push({
            type: 'tool-use',
            name: (id && toolNames.get(id)) || 'tool',
            input: data.input,
          })
          break
        }
        case 'session.tool.success': {
          const text = toolContentText(data.content)
          if (text) queue.push({ type: 'tool-result', text })
          const id = str(data.id)
          if (id) toolNames.delete(id)
          break
        }
        case 'session.tool.failed': {
          const text = toolContentText(data.content)
          const message = eventErrorMessage(data)
          const body = text || (message ? `工具执行失败：${message}` : '')
          if (body) queue.push({ type: 'tool-result', text: body })
          const id = str(data.id)
          if (id) toolNames.delete(id)
          break
        }
        case 'session.step.started': {
          modelID = str(data.model && (data.model as { id?: string }).id) ?? modelID
          break
        }
        case 'session.step.ended': {
          // 一步 LLM 调用结束，**不是**一轮结束：带工具的 turn 会依次跑多个 step，
          // 后面还会有新的 `step.started`，直到 `execution.*` 收尾。
          addUsage(data.tokens as V2Tokens | undefined)
          break
        }
        case 'session.step.failed': {
          // 单步失败可能只是触发重试（后面还有 `session.retry.scheduled`）；真正的
          // 终止由 `session.execution.failed` 宣告，这里只留一份错误文案兜底。
          lastStepError = eventErrorMessage(data) ?? lastStepError
          break
        }
        case 'session.execution.succeeded': {
          queue.push({
            type: 'turn-completed',
            usage,
            metrics: {
              usage: normalizeUsage('opencode-v2', usage),
              model: modelID,
            },
          })
          finish()
          break
        }
        case 'session.execution.failed': {
          queue.push({
            type: 'error',
            message: eventErrorMessage(data) ?? lastStepError ?? 'opencode v2 本轮执行失败',
          })
          finish()
          break
        }
        case 'session.execution.interrupted': {
          // 主动中断（用户 / 关停 / 被新 turn 取代）不算错误，直接结束本轮。
          finish()
          break
        }
        default:
          break
      }
    })

    try {
      const model = parseQualifiedModel(this.runtime.model)
      await this.adapter.sendPrompt(this.id, prompt, {
        model,
        variant: this.runtime.reasoningEffort,
      })
    } catch (err) {
      queue.push({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      finish()
    }

    try {
      for await (const event of queue) {
        if (this.aborted) return
        yield event
      }
    } finally {
      unsubscribe()
    }
  }

  private async abortInternal(): Promise<void> {
    this.aborted = true
    try {
      await this.adapter.interrupt(this.id)
    } catch {
      // best-effort
    }
  }

  abort(): void {
    void this.abortInternal()
  }
}

// ---------------------------------------------------------------------------
// 适配器
// ---------------------------------------------------------------------------

export interface OpenCodeV2AdapterOptions {
  /**
   * 显式指定 v2 的 opencode 可执行文件。给定后跳过自动探测（也跳过版本校验）。
   * 生产环境一般用 `OPENCODE_V2_CLI` 环境变量；这个选项主要给测试用。
   */
  cli?: string
}

export class OpenCodeV2Adapter implements AgentSdkAdapter {
  readonly kind = 'opencode-v2' as const
  readonly descriptor: AgentDescriptor = {
    id: 'opencode-v2',
    displayName: 'OpenCode V2',
    source: 'builtin',
    capabilities: { listSessions: true, getMessages: true, usageStatus: false },
  }

  private booting: Promise<{ server: OpenCodeV2Server; http: V2Http }> | null = null
  private bus: V2EventBus | null = null

  constructor(
    private readonly cwd: string,
    private readonly options: OpenCodeV2AdapterOptions = {},
  ) {}

  /** 启动本地 v2 服务端；失败时重置，允许下次重试。 */
  private async ensure(): Promise<{ server: OpenCodeV2Server; http: V2Http }> {
    if (!this.booting) {
      const cli = this.options.cli ?? (await resolveOpenCodeV2Cli())
      if (!cli) {
        throw new Error(
          '未找到 opencode v2 可执行文件。请安装可选依赖 `@opencode/cli`，' +
            '或安装 OpenCode 桌面版，或设置环境变量 OPENCODE_V2_CLI 指向 v2 的 opencode 可执行文件。',
        )
      }
      this.booting = OpenCodeV2Server.start(cli).then((server) => ({
        server,
        http: new V2Http(server.url, server.password, this.cwd),
      }))
      this.booting.catch(() => {
        this.booting = null
      })
    }
    return this.booting
  }

  /** 全局事件流；整条流由所有 session 共享。 */
  async ensureEvents(): Promise<V2EventBus> {
    if (this.bus) return this.bus
    const { http } = await this.ensure()
    const bus = new V2EventBus(http)
    this.bus = bus
    return bus
  }

  async createSession(opts?: { title?: string } & AgentRuntimeConfig): Promise<AgentSession> {
    const { http } = await this.ensure()
    const model = parseQualifiedModel(opts?.model)
    const res = await http.json<{ data: { id: string } }>('/api/session', {
      method: 'POST',
      json: {
        ...(opts?.title ? { title: opts.title } : {}),
        ...(model
          ? {
              model: {
                id: model.modelID,
                providerID: model.providerID,
                ...(opts?.reasoningEffort ? { variant: opts.reasoningEffort } : {}),
              },
            }
          : {}),
        location: { directory: this.cwd },
      },
    })
    const id = res?.data?.id
    if (!id) throw new Error('opencode v2 session.create failed')
    return new OpenCodeV2Session(id, this, opts)
  }

  async resumeSession(id: string, runtime?: AgentRuntimeConfig): Promise<AgentSession> {
    const { http } = await this.ensure()
    // 2.x 没有「创建时带模型」的补票：恢复会话时若指定了模型，需要显式切换。
    const model = parseQualifiedModel(runtime?.model)
    if (model) {
      // best-effort：会话不在这个服务端实例上时（404）不应该让恢复失败——
      // 与 v1 的宽松语义保持一致，真正的失败留到发消息时再报。
      await http
        .json(`/api/session/${id}/model`, {
          method: 'POST',
          json: {
            model: {
              id: model.modelID,
              providerID: model.providerID,
              ...(runtime?.reasoningEffort ? { variant: runtime.reasoningEffort } : {}),
            },
          },
        })
        .catch(() => undefined)
    }
    return new OpenCodeV2Session(id, this, runtime)
  }

  async listSessions(): Promise<SessionInfo[]> {
    const { http } = await this.ensure()
    const res = await http.json<{ data?: V2SessionInfo[] }>(
      `/api/session?directory=${encodeURIComponent(this.cwd)}&limit=200`,
    )
    return (res.data ?? []).map((s) => ({
      id: s.id,
      title: s.title || s.id,
      kind: this.kind,
      createdAt: s.time?.created ?? 0,
      updatedAt: s.time?.updated ?? s.time?.created ?? 0,
    }))
  }

  async getMessages(id: string): Promise<NormalizedMessage[]> {
    const { http } = await this.ensure()
    const res = await http.json<{ data?: V2Message[] }>(`/api/session/${id}/message`)
    // 2.x 的 message 列表是**倒序**的（newest-first）：最新的 idle / assistant 排在
    // 最前，本轮用户提问反而在最后。GUI 按数组顺序渲染（messagesToParts →
    // groupParts），原样透传会把 Agent 回复画在用户问题上方，所以这里翻回
    // oldest-first，与其它适配器、以及 `NormalizedMessage[]` 的契约保持一致。
    const messages = [...(res.data ?? [])].reverse()
    const out: NormalizedMessage[] = []
    for (const message of messages) {
      if (message.type === 'user') {
        const text = message.text
        if (text)
          out.push({ role: 'user', parts: [{ type: 'text', text }], ts: message.time?.created })
        continue
      }
      if (message.type !== 'assistant') continue
      const parts: MessagePart[] = []
      for (const part of message.content ?? []) {
        if (part.type === 'text' && part.text) {
          parts.push({ type: 'text', text: part.text })
        } else if (part.type === 'tool') {
          parts.push({
            type: 'tool-use',
            name: part.name ?? 'tool',
            input: part.state?.input,
          })
        }
      }
      if (parts.length) {
        out.push({ role: 'assistant', parts, ts: message.time?.created })
      }
    }
    return out
  }

  capabilities(): Capabilities {
    return this.descriptor.capabilities
  }

  async listModels(): Promise<AgentModelCatalog> {
    const { http } = await this.ensure()
    const res = await http.json<{ data?: V2ModelInfo[] }>('/api/model')
    const models: AgentModelOption[] = []
    for (const model of res.data ?? []) {
      if (model.enabled === false) continue
      if (model.status && model.status !== 'active') continue
      const id = `${model.providerID}/${model.id}`
      models.push({
        id,
        displayName: model.name ? `${model.providerID} · ${model.name}` : id,
        reasoningEfforts: (model.variants ?? []).map((variant) => ({
          id: variant.id,
          displayName: variant.id,
        })),
      })
    }
    return { models, defaultReasoningEfforts: [] }
  }

  /** 提交一轮 prompt。2.x 的 body 是平铺的 `{ text }`，不是 `{ prompt: { text } }`。 */
  async sendPrompt(
    sessionID: string,
    prompt: string,
    opts?: { model?: { providerID: string; modelID: string }; variant?: string },
  ): Promise<void> {
    const { http } = await this.ensure()
    if (opts?.model) {
      await http.json(`/api/session/${sessionID}/model`, {
        method: 'POST',
        json: {
          model: {
            id: opts.model.modelID,
            providerID: opts.model.providerID,
            ...(opts.variant ? { variant: opts.variant } : {}),
          },
        },
      })
    }
    await http.json(`/api/session/${sessionID}/prompt`, {
      method: 'POST',
      json: { text: prompt },
    })
  }

  async interrupt(sessionID: string): Promise<void> {
    const { http } = await this.ensure()
    await http.json(`/api/session/${sessionID}/interrupt`, { method: 'POST', json: {} })
  }

  async dispose(): Promise<void> {
    this.bus?.dispose()
    this.bus = null
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
