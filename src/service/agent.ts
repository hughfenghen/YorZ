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
  onStdout(cb: (chunk: string) => void): () => void
  onExit(cb: (code: number | null) => void): () => void
  onError(cb: (msg: string) => void): () => void
  buffer(): string
  kill(): void
  /** Resolves with the final exit code once the process terminates. */
  done: Promise<number | null>
}

export interface AgentRunnerOptions {
  cwd: string
  /** Override the agent command resolution (used by tests). */
  resolveAgentCmd?: () => AgentCmd
}

const BUFFER_MAX = 64 * 1024

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
    const emitter = new EventEmitter()
    let buf = ''
    const append = (chunk: string) => {
      buf += chunk
      if (buf.length > BUFFER_MAX) buf = buf.slice(buf.length - BUFFER_MAX)
    }

    const { cmd, args } = this.resolveCmd()
    let child: ChildProcess
    try {
      child = spawn(cmd, args(input.prompt), {
        cwd: this.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
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
        input,
        () => buf,
        emitter,
        () => {},
      )
    }

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf8')
      append(text)
      emitter.emit('stdout', text)
    })
    child.stderr?.on('data', (data: Buffer) => {
      // route stderr into stdout buffer for visibility; mark as error event too.
      const text = data.toString('utf8')
      append(text)
      emitter.emit('stdout', text)
    })
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
      input,
      () => buf,
      emitter,
      () => {
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore
        }
      },
    )
  }
}

function makeHandle(
  id: string,
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
