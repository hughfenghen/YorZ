import { spawn } from 'node:child_process'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { CommandRunStore } from './command-store.js'
import {
  OUTPUT_TAIL_LIMIT,
  RUN_RETENTION_MS,
  runLogRelPath,
  type CommandDef,
  type CommandOutputChunk,
  type CommandOutputSlice,
  type CommandRun,
} from './command-types.js'
import { loadProjectConfig, saveProjectConfig } from './project-config.js'
import { getLogger } from './logger.js'

const log = () => getLogger().child('commands')

const TAIL_POLL_MS = 200
const STOP_GRACE_MS = 2000

export class CommandNotFoundError extends Error {
  constructor(id: string) {
    super(`command not found: ${id}`)
    this.name = 'CommandNotFoundError'
  }
}

export class RunNotFoundError extends Error {
  constructor(id: string) {
    super(`command run not found: ${id}`)
    this.name = 'RunNotFoundError'
  }
}

/**
 * Tails one log file by polling its size and reading only the new bytes.
 *
 * Polling (rather than `fs.watch`) because the writer is a detached child
 * holding the fd directly — we never see write events, only size growth.
 * Reference-counted: the timer only runs while someone is subscribed.
 */
class LogTailer {
  private subscribers = new Set<(chunk: CommandOutputChunk) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private offset = 0

  constructor(private readonly file: string) {}

  get subscriberCount(): number {
    return this.subscribers.size
  }

  get running(): boolean {
    return this.timer !== null
  }

  /**
   * The first subscriber positions the tail at the current end of file: the GUI
   * has already fetched everything up to there over REST. Any gap caused by
   * writes landing between that fetch and this subscribe shows up as a
   * non-contiguous offset, which the GUI heals with a refetch.
   */
  subscribe(cb: (chunk: CommandOutputChunk) => void, fromOffset?: number): () => void {
    if (this.subscribers.size === 0) this.offset = fromOffset ?? currentSize(this.file)
    this.subscribers.add(cb)
    if (!this.timer) {
      this.timer = setInterval(() => this.poll(), TAIL_POLL_MS)
      this.timer.unref?.()
    }
    return () => {
      this.subscribers.delete(cb)
      if (this.subscribers.size === 0) this.stop()
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private poll(): void {
    let size: number
    try {
      size = statSync(this.file).size
    } catch {
      return // log file not created yet, or already cleared
    }
    if (size <= this.offset) {
      // Truncated out from under us (cleared + restarted): resync to the tail.
      if (size < this.offset) this.offset = size
      return
    }
    let fd: number | null = null
    try {
      fd = openSync(this.file, 'r')
      const length = size - this.offset
      const buf = Buffer.alloc(length)
      const read = readSync(fd, buf, 0, length, this.offset)
      if (read <= 0) return
      const chunk: CommandOutputChunk = {
        offset: this.offset,
        chunk: buf.subarray(0, read).toString('utf8'),
      }
      this.offset += read
      for (const cb of this.subscribers) {
        try {
          cb(chunk)
        } catch {
          // one bad subscriber must not break the tail loop
        }
      }
    } catch (err) {
      log().warn('tail read failed', { file: this.file, err })
    } finally {
      if (fd !== null) closeSync(fd)
    }
  }
}

/**
 * Owns command definitions, child processes and their logs for one project.
 *
 * Children are spawned detached (own process group, so `pnpm dev`-style
 * grandchildren die with the group) but their lifetime is tied to this service
 * process: `stopAll()` runs on shutdown and `reap()` cleans up on startup.
 */
export class CommandManager {
  private readonly store: CommandRunStore
  private readonly children = new Map<string, ReturnType<typeof spawn>>()
  private readonly tailers = new Map<string, LogTailer>()
  private readonly runsSubscribers = new Set<(runs: CommandRun[]) => void>()
  private readonly runSubscribers = new Map<string, Set<(run: CommandRun) => void>>()
  /**
   * Exits observed before `run()` finished persisting the record. A command
   * that dies immediately (bad shell syntax, missing binary) emits `exit`
   * before the first `upsert` lands; without this the terminal state would be
   * dropped and the record would stay `running` forever.
   */
  private readonly pendingEnds = new Map<
    string,
    { status: CommandRun['status']; exitCode: number | null; signal: string | null }
  >()
  private readonly persisted = new Set<string>()
  private initPromise: Promise<void> | null = null

  constructor(readonly projectPath: string) {
    this.store = new CommandRunStore(projectPath)
  }

  /** Idempotent startup pass: reap leftovers, drop expired records. */
  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.reap()
    return this.initPromise
  }

  // ---- definitions (persisted in .yorz/config.json) ----

  async listDefs(): Promise<CommandDef[]> {
    const cfg = await loadProjectConfig(this.projectPath)
    return cfg.commands
  }

  async addDef(name: string, cli: string): Promise<CommandDef> {
    const trimmedName = name.trim()
    const trimmedCli = cli.trim()
    if (!trimmedName) throw new Error('name is required')
    if (!trimmedCli) throw new Error('cli is required')
    const cfg = await loadProjectConfig(this.projectPath)
    const def: CommandDef = {
      id: shortId(),
      name: trimmedName,
      cli: trimmedCli,
      createdAt: Date.now(),
    }
    cfg.commands = [...cfg.commands, def]
    await saveProjectConfig(this.projectPath, cfg)
    return def
  }

  async removeDef(commandId: string): Promise<boolean> {
    const cfg = await loadProjectConfig(this.projectPath)
    const next = cfg.commands.filter((c) => c.id !== commandId)
    if (next.length === cfg.commands.length) return false
    cfg.commands = next
    await saveProjectConfig(this.projectPath, cfg)
    return true
  }

  // ---- runs ----

  async listRuns(): Promise<CommandRun[]> {
    await this.init()
    return this.store.list()
  }

  async getRun(runId: string): Promise<CommandRun | undefined> {
    await this.init()
    return this.store.get(runId)
  }

  /**
   * Spawn a command. Idempotent per definition: if that command already has a
   * live run, the existing record is returned instead of starting a second
   * process (two dev servers would just fight over the same port).
   */
  async run(commandId: string): Promise<CommandRun> {
    await this.init()
    const defs = await this.listDefs()
    const def = defs.find((d) => d.id === commandId)
    if (!def) throw new CommandNotFoundError(commandId)

    const existing = (await this.store.list()).find(
      (r) => r.commandId === commandId && r.status === 'running',
    )
    if (existing) return existing

    const runId = shortId()
    const logRel = runLogRelPath(runId)
    const logAbs = join(this.projectPath, '.yorz', 'tmp', 'commands', `${runId}.log`)
    await mkdir(join(this.projectPath, '.yorz', 'tmp', 'commands'), { recursive: true })

    const now = Date.now()
    let fd: number
    try {
      fd = openSync(logAbs, 'a')
    } catch (err) {
      const failed: CommandRun = {
        runId,
        commandId,
        name: def.name,
        cli: def.cli,
        pid: -1,
        status: 'failed',
        startedAt: now,
        endedAt: now,
        exitCode: null,
        signal: null,
        logFile: logRel,
      }
      log().error('failed to open command log', { runId, logAbs, err })
      await this.store.upsert(failed)
      this.notifyRuns()
      return failed
    }

    try {
      const child = spawn(def.cli, {
        shell: true,
        cwd: this.projectPath,
        env: process.env,
        detached: true,
        // No pipes: the child writes straight into the log fd. Keeps a chatty
        // dev server from buffering through this process, and lets the REST
        // first paint and the SSE tail read from one single source.
        stdio: ['ignore', fd, fd],
      })
      // Do not let a long-running child hold this process's event loop open;
      // lifetime is enforced explicitly by stopAll()/exit hooks instead.
      child.unref()

      const run: CommandRun = {
        runId,
        commandId,
        name: def.name,
        cli: def.cli,
        pid: child.pid ?? -1,
        status: 'running',
        startedAt: now,
        logFile: logRel,
      }

      if (!child.pid) {
        run.status = 'failed'
        run.endedAt = Date.now()
        run.exitCode = null
        run.signal = null
      } else {
        this.children.set(runId, child)
        // Listeners are attached synchronously so a fast exit is never missed;
        // handleExit() copes with the record not being on disk yet.
        child.on('exit', (code, signal) => {
          this.children.delete(runId)
          void this.handleExit(runId, signal ? 'killed' : 'exited', code, signal ?? null)
        })
        child.on('error', (err) => {
          log().warn('command child error', { runId, err })
          this.children.delete(runId)
          void this.handleExit(runId, 'failed', null, null)
        })
      }

      await this.store.upsert(run)
      this.persisted.add(runId)
      // Apply an exit that raced ahead of the write above.
      const raced = this.pendingEnds.get(runId)
      if (raced) {
        this.pendingEnds.delete(runId)
        await this.markRunEnded(runId, raced.status, raced.exitCode, raced.signal)
        const settled = await this.store.get(runId)
        if (settled) return settled
      }
      this.notifyRuns()
      log().info('command started', { runId, commandId, pid: run.pid, cli: def.cli })
      return run
    } finally {
      // The child inherited its own duplicate of the fd; ours is dead weight.
      try {
        closeSync(fd)
      } catch {
        // already closed
      }
    }
  }

  /** Terminate the process but keep the run record and its log. */
  async stop(runId: string): Promise<CommandRun> {
    await this.init()
    const run = await this.store.get(runId)
    if (!run) throw new RunNotFoundError(runId)
    if (run.status !== 'running') return run
    await this.terminate(run)
    return (await this.store.get(runId)) ?? run
  }

  /** Terminate if needed, then drop the record and delete the log file. */
  async clear(runId: string): Promise<boolean> {
    await this.init()
    const run = await this.store.get(runId)
    if (!run) return false
    if (run.status === 'running') await this.terminate(run)
    this.tailers.get(runId)?.stop()
    this.tailers.delete(runId)
    await this.store.remove(runId)
    await rm(join(this.projectPath, run.logFile), { force: true }).catch(() => {})
    this.runSubscribers.delete(runId)
    this.persisted.delete(runId)
    this.pendingEnds.delete(runId)
    this.notifyRuns()
    return true
  }

  async readOutput(runId: string, offset?: number): Promise<CommandOutputSlice> {
    await this.init()
    const run = await this.store.get(runId)
    if (!run) throw new RunNotFoundError(runId)
    return readLogSlice(join(this.projectPath, run.logFile), offset)
  }

  // ---- subscriptions (SSE) ----

  subscribeRuns(cb: (runs: CommandRun[]) => void): () => void {
    this.runsSubscribers.add(cb)
    return () => this.runsSubscribers.delete(cb)
  }

  subscribeRun(runId: string, cb: (run: CommandRun) => void): () => void {
    let set = this.runSubscribers.get(runId)
    if (!set) {
      set = new Set()
      this.runSubscribers.set(runId, set)
    }
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) this.runSubscribers.delete(runId)
    }
  }

  subscribeOutput(
    runId: string,
    cb: (chunk: CommandOutputChunk) => void,
    fromOffset?: number,
  ): () => void {
    const file = join(this.projectPath, runLogRelPath(runId))
    let tailer = this.tailers.get(runId)
    if (!tailer) {
      tailer = new LogTailer(file)
      this.tailers.set(runId, tailer)
    }
    const unsub = tailer.subscribe(cb, fromOffset)
    return () => {
      unsub()
      const t = this.tailers.get(runId)
      if (t && t.subscriberCount === 0) this.tailers.delete(runId)
    }
  }

  // ---- lifecycle ----

  /**
   * Stop every live child. Called on service shutdown: commands are tied to the
   * service lifetime, so nothing outlives it.
   */
  async stopAll(): Promise<void> {
    const runs = await this.store.list().catch(() => [] as CommandRun[])
    const live = runs.filter((r) => r.status === 'running')
    await Promise.all(live.map((r) => this.terminate(r).catch(() => {})))
    for (const t of this.tailers.values()) t.stop()
    this.tailers.clear()
  }

  /** Last-resort synchronous kill for `process.on('exit')`, which cannot await. */
  stopAllSync(): void {
    for (const [runId, child] of this.children) {
      const pid = child.pid
      if (!pid) continue
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
      this.children.delete(runId)
    }
    for (const t of this.tailers.values()) t.stop()
  }

  /**
   * Startup pass. Any record still marked `running` belongs to a previous
   * service process: kill it if it somehow survived (service SIGKILLed), then
   * mark it `killed`. Also drops records that finished long ago.
   */
  private async reap(): Promise<void> {
    const runs = await this.store.list().catch(() => [] as CommandRun[])
    if (runs.length === 0) return
    const now = Date.now()
    const kept: CommandRun[] = []
    const dropped: CommandRun[] = []

    for (const run of runs) {
      if (run.status === 'running') {
        if (run.pid > 0 && isAlive(run.pid)) {
          killGroup(run.pid, 'SIGKILL')
          log().warn('reaped orphan command process', { runId: run.runId, pid: run.pid })
        }
        kept.push({ ...run, status: 'killed', endedAt: run.endedAt ?? now, exitCode: null })
        continue
      }
      const endedAt = run.endedAt ?? run.startedAt
      if (now - endedAt > RUN_RETENTION_MS) dropped.push(run)
      else kept.push(run)
    }

    await this.store.replaceAll(kept)
    for (const run of dropped) {
      await rm(join(this.projectPath, run.logFile), { force: true }).catch(() => {})
    }
  }

  private async terminate(run: CommandRun): Promise<void> {
    if (run.pid > 0) {
      killGroup(run.pid, 'SIGTERM')
      const exited = await waitForExit(run.pid, STOP_GRACE_MS)
      if (!exited) {
        log().warn('command did not exit on SIGTERM, escalating', {
          runId: run.runId,
          pid: run.pid,
        })
        killGroup(run.pid, 'SIGKILL')
        await waitForExit(run.pid, STOP_GRACE_MS)
      }
    }
    this.children.delete(run.runId)
    await this.markRunEnded(run.runId, 'killed', null, 'SIGTERM')
  }

  private async handleExit(
    runId: string,
    status: CommandRun['status'],
    exitCode: number | null,
    signal: NodeJS.Signals | string | null,
  ): Promise<void> {
    if (!this.persisted.has(runId)) {
      this.pendingEnds.set(runId, { status, exitCode, signal: signal ?? null })
      return
    }
    await this.markRunEnded(runId, status, exitCode, signal)
  }

  private async markRunEnded(
    runId: string,
    status: CommandRun['status'],
    exitCode: number | null,
    signal: NodeJS.Signals | string | null,
  ): Promise<void> {
    const run = await this.store.get(runId)
    if (!run || run.status !== 'running') return
    const next: CommandRun = {
      ...run,
      status,
      endedAt: Date.now(),
      exitCode,
      signal: signal ?? null,
    }
    await this.store.upsert(next)
    this.notifyRuns()
    this.notifyRun(next)
    log().info('command ended', { runId, status, exitCode, signal })
  }

  private notifyRuns(): void {
    if (this.runsSubscribers.size === 0) return
    void this.store.list().then((runs) => {
      for (const cb of this.runsSubscribers) {
        try {
          cb(runs)
        } catch {
          // subscriber errors must not break the notify loop
        }
      }
    })
  }

  private notifyRun(run: CommandRun): void {
    const set = this.runSubscribers.get(run.runId)
    if (!set) return
    for (const cb of set) {
      try {
        cb(run)
      } catch {
        // ignore
      }
    }
  }
}

// ---- process-level singleton registry ----

const managers = new Map<string, CommandManager>()

/**
 * Managers are keyed by project path and live at process scope on purpose:
 * `ProjectRegistry.reload()` throws away the ProjectInstance whenever the
 * project config is saved, which would otherwise orphan every running child.
 */
export function getCommandManager(projectPath: string): CommandManager {
  let m = managers.get(projectPath)
  if (!m) {
    m = new CommandManager(projectPath)
    managers.set(projectPath, m)
  }
  return m
}

export async function stopAllCommandManagers(): Promise<void> {
  const all = [...managers.values()]
  managers.clear()
  await Promise.all(all.map((m) => m.stopAll().catch(() => {})))
}

export function stopAllCommandManagersSync(): void {
  for (const m of managers.values()) m.stopAllSync()
  managers.clear()
}

/** Test helper: forget cached managers without touching child processes. */
export function resetCommandManagers(): void {
  managers.clear()
}

// ---- helpers ----

export function readLogSlice(file: string, offset?: number): CommandOutputSlice {
  let size = 0
  try {
    size = statSync(file).size
  } catch {
    return { offset: 0, text: '', size: 0, truncated: false }
  }
  let start = offset ?? Math.max(0, size - OUTPUT_TAIL_LIMIT)
  let truncated = offset === undefined && start > 0
  if (start > size) start = size
  if (start < 0) start = 0
  // An explicit offset can still ask for more than we're willing to send.
  if (size - start > OUTPUT_TAIL_LIMIT) {
    start = size - OUTPUT_TAIL_LIMIT
    truncated = true
  }
  const length = size - start
  if (length <= 0) return { offset: start, text: '', size, truncated }
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(length)
    const read = readSync(fd, buf, 0, length, start)
    return { offset: start, text: buf.subarray(0, read).toString('utf8'), size, truncated }
  } catch {
    return { offset: start, text: '', size, truncated }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function currentSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

function shortId(): string {
  return randomBytes(8).toString('hex')
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Signal the whole process group. `pnpm dev` forks the process actually holding
 * the port, so killing only the direct child leaves it running.
 */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (!isAlive(pid)) return true
    await sleep(50)
  }
  return !isAlive(pid)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
