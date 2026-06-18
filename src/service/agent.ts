import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { resolveAgentCmd, type AgentCmd } from './agent-config.js'

export type AgentMode = 'skill-run' | 'explain'

export interface RunAgentInput {
  specId: string
  mode: AgentMode
  prompt: string
}

export interface AgentRunHandle {
  id: string
  mode: AgentMode
  specId: string
  startedAt: number
  onStdout(cb: (chunk: string) => void): () => void
  onExit(cb: (code: number | null) => void): () => void
  onError(cb: (msg: string) => void): () => void
  buffer(): string
  kill(): void
  /** Resolves with the final exit code once the process terminates. */
  done: Promise<number | null>
}

export interface ActiveRunInfo {
  runId: string
  mode: AgentMode
  specId: string
  startedAt: number
}

export interface AgentRunnerOptions {
  cwd: string
  /** Override the agent command resolution (used by tests). */
  resolveAgentCmd?: () => AgentCmd
}

const BUFFER_MAX = 64 * 1024
const KILL_GRACE_MS = 2000
const TOOL_RESULT_TRUNCATE = 400

export class AgentRunner {
  private readonly cwd: string
  private readonly resolveCmd: () => AgentCmd
  private readonly skillRunBySpec = new Map<string, AgentRunHandle>()
  private readonly handlesById = new Map<string, AgentRunHandle>()
  private readonly listenersBySpec = new Map<string, Set<(h: AgentRunHandle) => void>>()

  constructor(opts: AgentRunnerOptions) {
    this.cwd = opts.cwd
    this.resolveCmd = opts.resolveAgentCmd ?? (() => resolveAgentCmd({ cwd: opts.cwd }))
  }

  run(input: RunAgentInput): AgentRunHandle {
    if (input.mode === 'skill-run') {
      const existing = this.skillRunBySpec.get(input.specId)
      if (existing) return existing
    }
    const handle = this.spawn(input)
    this.handlesById.set(handle.id, handle)
    if (input.mode === 'skill-run') {
      this.skillRunBySpec.set(input.specId, handle)
    }
    handle.onExit(() => {
      this.handlesById.delete(handle.id)
      if (input.mode === 'skill-run' && this.skillRunBySpec.get(input.specId) === handle) {
        this.skillRunBySpec.delete(input.specId)
      }
    })
    const subs = this.listenersBySpec.get(input.specId)
    if (subs) for (const cb of subs) cb(handle)
    return handle
  }

  get(runId: string): AgentRunHandle | undefined {
    return this.handlesById.get(runId)
  }

  /** Returns currently active runs for a given spec (used by SSE backfill). */
  active(specId: string): AgentRunHandle[] {
    const out: AgentRunHandle[] = []
    for (const h of this.handlesById.values()) {
      if (h.specId === specId) out.push(h)
    }
    return out
  }

  /** Lists all currently active runs (used by GUI hydration after refresh). */
  listActive(): ActiveRunInfo[] {
    const out: ActiveRunInfo[] = []
    for (const h of this.handlesById.values()) {
      out.push({ runId: h.id, mode: h.mode, specId: h.specId, startedAt: h.startedAt })
    }
    return out
  }

  /** Cancel an active run by id. Returns false when no live handle is found. */
  cancel(runId: string): boolean {
    const h = this.handlesById.get(runId)
    if (!h) return false
    h.kill()
    return true
  }

  /** Subscribe to *future* runs for a given spec. Returns unsubscribe. */
  subscribe(specId: string, cb: (handle: AgentRunHandle) => void): () => void {
    let set = this.listenersBySpec.get(specId)
    if (!set) {
      set = new Set()
      this.listenersBySpec.set(specId, set)
    }
    set.add(cb)
    return () => {
      const s = this.listenersBySpec.get(specId)
      if (!s) return
      s.delete(cb)
      if (s.size === 0) this.listenersBySpec.delete(specId)
    }
  }

  private spawn(input: RunAgentInput): AgentRunHandle {
    const id = randomUUID()
    const startedAt = Date.now()
    const emitter = new EventEmitter()
    let buf = ''
    const append = (chunk: string) => {
      buf += chunk
      if (buf.length > BUFFER_MAX) buf = buf.slice(buf.length - BUFFER_MAX)
    }
    const pushStdout = (text: string) => {
      if (!text) return
      append(text)
      emitter.emit('stdout', text)
    }

    const cmd = this.resolveCmd()
    let child: ChildProcess
    try {
      child = spawn(cmd.cmd, cmd.args(input.prompt), {
        cwd: this.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Run the child as the leader of its own process group so kill() can
        // signal the whole tree (claude may spawn tool sub-processes).
        detached: true,
      })
    } catch (err) {
      // synchronous spawn failure (e.g. invalid options)
      const msg = (err as Error).message
      queueMicrotask(() => {
        emitter.emit('error', msg)
        emitter.emit('exit', null)
      })
      return makeHandle(
        id,
        startedAt,
        input,
        () => buf,
        emitter,
        () => {},
      )
    }

    if (cmd.streamFormat === 'json') {
      attachJsonlStream(child, emitter, pushStdout)
    } else {
      child.stdout?.on('data', (data: Buffer) => pushStdout(data.toString('utf8')))
    }
    child.stderr?.on('data', (data: Buffer) => pushStdout(data.toString('utf8')))
    let exited = false
    child.on('error', (err) => {
      emitter.emit('error', err.message)
      if (!exited) {
        exited = true
        emitter.emit('exit', null)
      }
    })
    child.on('exit', (code) => {
      if (!exited) {
        exited = true
        emitter.emit('exit', code)
      }
    })

    return makeHandle(
      id,
      startedAt,
      input,
      () => buf,
      emitter,
      () => killTree(child, () => exited),
    )
  }
}

function attachJsonlStream(
  child: ChildProcess,
  emitter: EventEmitter,
  pushStdout: (text: string) => void,
): void {
  let pending = ''
  child.stdout?.on('data', (data: Buffer) => {
    pending += data.toString('utf8')
    let idx: number
    while ((idx = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, idx).trimEnd()
      pending = pending.slice(idx + 1)
      if (!line) continue
      handleLine(line, emitter, pushStdout)
    }
  })
  child.stdout?.on('end', () => {
    if (pending.trim()) handleLine(pending.trim(), emitter, pushStdout)
    pending = ''
  })
}

function handleLine(line: string, emitter: EventEmitter, pushStdout: (text: string) => void): void {
  let ev: unknown
  try {
    ev = JSON.parse(line)
  } catch {
    emitter.emit('error', `agent stream JSON parse failed: ${line.slice(0, 200)}`)
    pushStdout(`${line}\n`)
    return
  }
  pushStdout(formatStreamEvent(ev))
}

/**
 * Convert one parsed claude `--output-format stream-json` event into a
 * human-readable text fragment. Exported for tests.
 */
export function formatStreamEvent(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return `${JSON.stringify(ev)}\n`
  const obj = ev as Record<string, unknown>
  const type = String(obj.type ?? '')

  switch (type) {
    case 'system': {
      const subtype = obj.subtype ? String(obj.subtype) : 'event'
      return `[system] ${subtype}\n`
    }
    case 'assistant':
    case 'user': {
      return formatMessage(obj)
    }
    case 'message_delta': {
      const delta = obj.delta as { text?: unknown } | undefined
      if (delta && typeof delta.text === 'string') return delta.text
      return `${JSON.stringify(ev)}\n`
    }
    case 'result': {
      const subtype = obj.subtype ? String(obj.subtype) : ''
      const isError = obj.is_error === true ? ' is_error=true' : ''
      return `[result] ${subtype}${isError}\n`
    }
    default:
      return `${JSON.stringify(ev)}\n`
  }
}

function formatMessage(obj: Record<string, unknown>): string {
  const msg = obj.message as Record<string, unknown> | undefined
  if (!msg) return `${JSON.stringify(obj)}\n`
  const content = msg.content
  if (!Array.isArray(content)) return `${JSON.stringify(obj)}\n`
  let out = ''
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    const ptype = String(p.type ?? '')
    if (ptype === 'text') {
      if (typeof p.text === 'string') out += p.text
    } else if (ptype === 'tool_use') {
      const name = String(p.name ?? '?')
      const input = JSON.stringify(p.input ?? {})
      out += `\n[tool] ${name}(${truncate(input, TOOL_RESULT_TRUNCATE)})\n`
    } else if (ptype === 'tool_result') {
      out += `[tool-result] ${truncate(stringifyToolResult(p.content), TOOL_RESULT_TRUNCATE)}\n`
    }
  }
  return out
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    let acc = ''
    for (const c of content) {
      if (c && typeof c === 'object') {
        const cc = c as Record<string, unknown>
        if (typeof cc.text === 'string') {
          acc += cc.text
          continue
        }
      }
      acc += JSON.stringify(c)
    }
    return acc
  }
  return JSON.stringify(content)
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

function killTree(child: ChildProcess, hasExited: () => boolean): void {
  const pid = child.pid
  const sendTerm = () => {
    if (typeof pid === 'number') {
      try {
        process.kill(-pid, 'SIGTERM')
        return
      } catch {
        // fall through to direct kill
      }
    }
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
  }
  const sendKill = () => {
    if (typeof pid === 'number') {
      try {
        process.kill(-pid, 'SIGKILL')
        return
      } catch {
        // fall through
      }
    }
    try {
      child.kill('SIGKILL')
    } catch {
      // ignore
    }
  }
  sendTerm()
  setTimeout(() => {
    if (hasExited()) return
    sendKill()
  }, KILL_GRACE_MS).unref?.()
}

function makeHandle(
  id: string,
  startedAt: number,
  input: RunAgentInput,
  bufferFn: () => string,
  emitter: EventEmitter,
  killFn: () => void,
): AgentRunHandle {
  const done = new Promise<number | null>((resolve) => {
    emitter.once('exit', (code: number | null) => resolve(code))
  })
  return {
    id,
    mode: input.mode,
    specId: input.specId,
    startedAt,
    buffer: bufferFn,
    kill: killFn,
    done,
    onStdout(cb) {
      emitter.on('stdout', cb)
      return () => emitter.off('stdout', cb)
    },
    onExit(cb) {
      emitter.on('exit', cb)
      return () => emitter.off('exit', cb)
    },
    onError(cb) {
      emitter.on('error', cb)
      return () => emitter.off('error', cb)
    },
  }
}
