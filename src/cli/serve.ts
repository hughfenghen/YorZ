import { execFile, spawn, type StdioOptions } from 'node:child_process'
import { existsSync, mkdirSync, openSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { start, type ServeHandle } from '../service/index.js'
import { resolveGlobalConfigDir } from '../service/global-config.js'
import { configureLogger, getLogger, resolveLogDir, STDIO_LOG_FILE } from '../service/logger.js'
import { cleanupLegacyAgentSkills, ensureSkillsInstalled } from './install.js'

const log = () => getLogger().child('serve')
const execFileAsync = promisify(execFile)

/**
 * `yorz serve` (background launcher) and `yorz serve stop` are pure CLI
 * operations: this process never hosts the service, and it already prints its
 * own user-facing messages. Mirroring the internal serve log on top of those
 * would clutter the terminal, so file-only here. Foreground mode does NOT go
 * through these paths and keeps console mirroring.
 */
function silenceConsoleMirror(): void {
  configureLogger({ mirrorConsole: false })
}

export interface ServeCommandOptions {
  port?: number
  /** Bind address; defaults to loopback in the service layer. */
  host?: string
  open?: boolean
  cwd?: string
  noRegisterCwd?: boolean
  foreground?: boolean
  /** Internal: skip the skill install/update check (set on the background child). */
  skipSkillCheck?: boolean
  /** Internal: record this process in runtime.json so background management can stop it. */
  recordRuntime?: boolean
}

export interface BackgroundServeResult {
  background: true
  pid?: number
  port: number
  url: string
  reused?: boolean
}

export interface StopServeResult {
  stopped: boolean
  stoppedPids: number[]
  urls: string[]
  message: string
}

export interface ProcessEntry {
  pid: number
  port: number
  url: string
  startedAt: string
  execPath?: string
  argv?: string[]
  processStartedAt?: string
}

interface ProcessSnapshot {
  commandLine: string
  processStartedAt?: string
}

const DEFAULT_SERVE_PORT = 7423
const RUNTIME_FILE = 'runtime.json'
const START_LOCK_DIR = 'serve.lock'
const START_WAIT_MS = 5000
const RESTART_DELAY_MS = 500

export interface BackgroundStdio {
  stdio: StdioOptions
  /** Path of the stdio fallback file, or `null` when we fell back to `'ignore'`. */
  path: string | null
}

export interface RestartServeOptions extends ServeCommandOptions {
  worker?: boolean
}

/**
 * stdio target for the detached child. Anything the logger does not own — a
 * dependency printing straight to stdout, a Node fatal error stack, an OOM
 * notice — would otherwise vanish into `/dev/null`.
 *
 * Opened with `'w'` so every start truncates it: bounded by construction, no
 * rotation needed. Deliberately NOT `serve.log` — rotation renames that file
 * and the child's fd would keep writing into the archived inode.
 *
 * Any failure (unwritable dir, fd exhaustion) falls back to the previous
 * `'ignore'` behaviour rather than blocking startup.
 */
export function backgroundStdio(): BackgroundStdio {
  try {
    const dir = resolveLogDir()
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, STDIO_LOG_FILE)
    const fd = openSync(filePath, 'w')
    return { stdio: ['ignore', fd, fd], path: filePath }
  } catch {
    return { stdio: 'ignore', path: null }
  }
}

export async function runServe(
  opts: ServeCommandOptions,
): Promise<ServeHandle | BackgroundServeResult> {
  if (!opts.skipSkillCheck) {
    await ensureSkillsInstalledWithLog(opts.cwd ?? process.cwd())
  }

  if (!opts.foreground) {
    return startBackgroundServe(opts)
  }

  const handle = await start({
    port: opts.port,
    host: opts.host,
    open: opts.open,
    cwd: opts.cwd ?? process.cwd(),
    noRegisterCwd: opts.noRegisterCwd,
  })

  if (opts.recordRuntime) {
    const snapshot = await readProcessSnapshot(process.pid)
    await upsertProcess({
      pid: process.pid,
      port: handle.port,
      url: handle.url,
      startedAt: new Date().toISOString(),
      execPath: process.execPath,
      argv: process.argv,
      processStartedAt: snapshot?.processStartedAt,
    })
    console.log(`Stop with: yorz serve stop`)
  } else {
    console.log(`Stop with: Ctrl-C`)
  }

  const shutdown = async () => {
    console.log('\nShutting down YorZ Service…')
    try {
      await handle.close()
    } finally {
      if (opts.recordRuntime) await removeRuntimeForPid(process.pid)
      process.exit(0)
    }
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  return handle
}

function startBackgroundServe(opts: ServeCommandOptions): Promise<BackgroundServeResult> {
  silenceConsoleMirror()
  return withStartLock(async () => {
    const live = await readLiveProcesses()
    if (live.length > 0) {
      const existing = live[0]!
      console.log(`YorZ Service is already running in background (pid=${existing.pid}).`)
      console.log(`Open ${existing.url}`)
      console.log(`Stop with: yorz serve stop`)
      return {
        background: true,
        reused: true,
        pid: existing.pid,
        port: existing.port,
        url: existing.url,
      }
    }

    const entry = process.argv[1]
    if (!entry) throw new Error('Cannot resolve CLI entrypoint for background service')

    const stdio = backgroundStdio()
    const child = spawn(process.execPath, [entry, 'serve', ...backgroundArgs(opts)], {
      detached: true,
      stdio: stdio.stdio,
    })
    child.unref()
    log().info('background service spawned', {
      pid: child.pid,
      stdioFile: stdio.path,
      logFile: getLogger().filePath,
    })

    const runtime = await waitForRuntime(child.pid, START_WAIT_MS)
    if (!runtime) {
      log().warn('timed out waiting for runtime.json', {
        pid: child.pid,
        timeoutMs: START_WAIT_MS,
      })
    }
    const port = runtime?.port ?? opts.port ?? DEFAULT_SERVE_PORT
    const url = runtime?.url ?? `http://localhost:${port}/`
    console.log(`YorZ Service started in background (pid=${child.pid ?? 'unknown'}).`)
    console.log(`Open ${url}${runtime ? '' : ` (or the next free port if ${port} is busy).`}`)
    console.log(`Stop with: yorz serve stop`)

    return {
      background: true,
      pid: child.pid,
      url,
      port,
    }
  })
}

export function backgroundArgs(opts: ServeCommandOptions): string[] {
  const args = ['--foreground']
  if (opts.port !== undefined) args.push('--port', String(opts.port))
  if (opts.host !== undefined) args.push('--host', opts.host)
  if (opts.open) args.push('--open')
  if (opts.cwd) args.push('--cwd', opts.cwd)
  if (opts.noRegisterCwd) args.push('--no-register-cwd')
  // The parent already ran the skill check and printed logs; the detached child
  // has stdio ignored, so skip the check to avoid a redundant install pass.
  args.push('--skip-skill-check')
  // Background service children run through foreground hosting internally, but
  // still need a runtime record for readiness probing and `yorz serve stop`.
  args.push('--record-runtime')
  return args
}

export function restartWorkerArgs(opts: ServeCommandOptions): string[] {
  const args = ['serve', 'restart', '--worker']
  if (opts.port !== undefined) args.push('--port', String(opts.port))
  if (opts.host !== undefined) args.push('--host', opts.host)
  if (opts.open) args.push('--open')
  if (opts.cwd) args.push('--cwd', opts.cwd)
  if (opts.noRegisterCwd) args.push('--no-register-cwd')
  args.push('--skip-skill-check')
  return args
}

export async function runRestartServe(opts: RestartServeOptions = {}): Promise<void> {
  silenceConsoleMirror()
  if (opts.worker) {
    await sleep(RESTART_DELAY_MS)
    await runStopServe()
    await runServe({ ...opts, foreground: false, skipSkillCheck: opts.skipSkillCheck ?? true })
    return
  }

  const entry = process.argv[1]
  if (!entry) throw new Error('Cannot resolve CLI entrypoint for restart')
  const child = spawn(process.execPath, [entry, ...restartWorkerArgs(opts)], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  console.log(`YorZ Service restart scheduled (pid=${child.pid ?? 'unknown'}).`)
}

async function ensureSkillsInstalledWithLog(cwd: string): Promise<void> {
  const results = await ensureSkillsInstalled({ cwd })
  for (const r of results) {
    if (r.status === 'installed') {
      console.log(`[skill] ${r.skill} installed: ${r.path}`)
    } else if (r.status === 'updated') {
      console.log(`[skill] ${r.skill} updated: ${r.path}`)
    } else {
      console.log(`[skill] ${r.skill} is up to date: ${r.path}`)
    }
  }
  // Undo the per-Agent pollution written by pre-shared-install versions, so an
  // upgraded install doesn't leave two copies of the same skill in play.
  const legacy = await cleanupLegacyAgentSkills({ home: homedir(), cwd })
  for (const r of legacy) {
    if (r.reason === 'removed') console.log(`[skill][legacy] ${r.skill} removed: ${r.path}`)
    else if (r.reason === 'foreign')
      console.log(`[skill][legacy] ${r.skill} kept (not a YorZ skill): ${r.path}`)
  }
}

export async function runStopServe(): Promise<StopServeResult> {
  silenceConsoleMirror()
  const all = await readAllProcesses()
  if (all.length === 0) {
    return {
      stopped: false,
      stoppedPids: [],
      urls: [],
      message: 'YorZ Service is not running.',
    }
  }

  const checks = await Promise.all(
    all.map(async (proc) => ({ proc, snapshot: await readProcessSnapshot(proc.pid) })),
  )
  const alive = checks.filter(
    (check) => check.snapshot && isStoppableYorzProcess(check.proc, check.snapshot),
  )
  const dead = checks.filter(
    (check) => !check.snapshot || !isStoppableYorzProcess(check.proc, check.snapshot),
  )

  if (alive.length === 0) {
    await removeRuntime()
    log().warn('cleared stale runtime records', { pids: dead.map((p) => p.proc.pid) })
    const deadPidList = dead.map((p) => `pid=${p.proc.pid}`).join(', ')
    return {
      stopped: false,
      stoppedPids: [],
      urls: [],
      message: `YorZ Service was not running; removed stale runtime for ${deadPidList}.`,
    }
  }

  const stoppedPids: number[] = []
  const stoppedUrls: string[] = []
  const failedPids: number[] = []

  for (const { proc } of alive) {
    try {
      process.kill(proc.pid, 'SIGTERM')
      log().info('sent SIGTERM', { pid: proc.pid, url: proc.url })
    } catch (err) {
      log().warn('SIGTERM failed', { pid: proc.pid, err })
      failedPids.push(proc.pid)
      continue
    }

    let stopped = await waitForProcessExit(proc.pid, 2000)
    if (!stopped) {
      log().warn('still alive after SIGTERM, escalating to SIGKILL', { pid: proc.pid })
      try {
        process.kill(proc.pid, 'SIGKILL')
      } catch {
        // It may have exited between the final poll and SIGKILL.
      }
      stopped = await waitForProcessExit(proc.pid, 2000)
    }

    if (stopped) {
      stoppedPids.push(proc.pid)
      stoppedUrls.push(proc.url)
    } else {
      log().warn('process did not exit', { pid: proc.pid })
      failedPids.push(proc.pid)
    }
  }

  if (failedPids.length === 0) {
    await removeRuntime()
  } else {
    await writeAllProcesses(all.filter((p) => failedPids.includes(p.pid)))
  }

  const pidList = stoppedPids.map((p) => `pid=${p}`).join(', ')
  if (failedPids.length > 0) {
    const failedList = failedPids.map((p) => `pid=${p}`).join(', ')
    return {
      stopped: stoppedPids.length > 0,
      stoppedPids,
      urls: stoppedUrls,
      message: `Stopped ${stoppedPids.length} process(es): ${pidList}. Still running: ${failedList}.`,
    }
  }

  return {
    stopped: true,
    stoppedPids,
    urls: stoppedUrls,
    message: `Stopped ${stoppedPids.length} YorZ Service process(es): ${pidList}.`,
  }
}

export function runtimePath(): string {
  return join(resolveGlobalConfigDir(), RUNTIME_FILE)
}

function startLockPath(): string {
  return join(resolveGlobalConfigDir(), START_LOCK_DIR)
}

async function withStartLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockPath = startLockPath()
  await mkdir(resolveGlobalConfigDir(), { recursive: true })
  try {
    await mkdir(lockPath, { recursive: false })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'EEXIST') throw err
    const existing = await waitForLiveRuntime(START_WAIT_MS)
    if (existing) return await fn()
    await rm(lockPath, { recursive: true, force: true })
    await mkdir(lockPath, { recursive: false })
  }

  try {
    return await fn()
  } finally {
    await rm(lockPath, { recursive: true, force: true })
  }
}

async function waitForLiveRuntime(timeoutMs: number): Promise<ProcessEntry | null> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const live = await readLiveProcesses()
    if (live.length > 0) return live[0]!
    await sleep(100)
  }
  return null
}

async function waitForRuntime(
  pid: number | undefined,
  timeoutMs: number,
): Promise<ProcessEntry | null> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const live = await readLiveProcesses()
    const match = live.find((p) => pid === undefined || p.pid === pid)
    if (match) return match
    await sleep(100)
  }
  return null
}

async function readLiveProcesses(): Promise<ProcessEntry[]> {
  const all = await readAllProcesses()
  if (all.length === 0) return []

  const checks = await Promise.all(
    all.map(async (proc) => ({ proc, snapshot: await readProcessSnapshot(proc.pid) })),
  )
  const alive = checks
    .filter((check) => check.snapshot && isStoppableYorzProcess(check.proc, check.snapshot))
    .map((check) => check.proc)
  const dead = checks.filter(
    (check) => !check.snapshot || !isStoppableYorzProcess(check.proc, check.snapshot),
  )

  if (dead.length > 0) {
    if (alive.length === 0) {
      await removeRuntime()
    } else {
      await writeAllProcesses(alive)
    }
  }

  return alive
}

async function readAllProcesses(): Promise<ProcessEntry[]> {
  const path = runtimePath()
  if (!existsSync(path)) return []
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    if (parsed.version === 2 && Array.isArray(parsed.processes)) {
      return (parsed.processes as unknown[]).filter(isValidEntry).map(toProcessEntry)
    }

    if (parsed.version === 1) {
      const entry = tryV1Entry(parsed)
      if (entry) return [entry]
    }

    return []
  } catch {
    return []
  }
}

function isValidEntry(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return (
    typeof o.pid === 'number' &&
    typeof o.port === 'number' &&
    typeof o.url === 'string' &&
    typeof o.startedAt === 'string'
  )
}

function toProcessEntry(obj: Record<string, unknown>): ProcessEntry {
  return {
    pid: obj.pid as number,
    port: obj.port as number,
    url: obj.url as string,
    startedAt: obj.startedAt as string,
    execPath: typeof obj.execPath === 'string' ? obj.execPath : undefined,
    argv:
      Array.isArray(obj.argv) && obj.argv.every((v) => typeof v === 'string')
        ? obj.argv
        : undefined,
    processStartedAt: typeof obj.processStartedAt === 'string' ? obj.processStartedAt : undefined,
  }
}

function tryV1Entry(parsed: Record<string, unknown>): ProcessEntry | null {
  if (
    typeof parsed.pid !== 'number' ||
    typeof parsed.port !== 'number' ||
    typeof parsed.url !== 'string' ||
    typeof parsed.startedAt !== 'string'
  ) {
    return null
  }
  return {
    pid: parsed.pid,
    port: parsed.port,
    url: parsed.url,
    startedAt: parsed.startedAt,
    execPath: typeof parsed.execPath === 'string' ? parsed.execPath : undefined,
    argv:
      Array.isArray(parsed.argv) && parsed.argv.every((v) => typeof v === 'string')
        ? parsed.argv
        : undefined,
    processStartedAt:
      typeof parsed.processStartedAt === 'string' ? parsed.processStartedAt : undefined,
  }
}

async function upsertProcess(entry: ProcessEntry): Promise<void> {
  const all = await readAllProcesses()
  const idx = all.findIndex((p) => p.pid === entry.pid)
  if (idx >= 0) all[idx] = entry
  else all.push(entry)
  await writeAllProcesses(all)
}

async function writeAllProcesses(processes: ProcessEntry[]): Promise<void> {
  const path = runtimePath()
  await mkdir(resolveGlobalConfigDir(), { recursive: true })
  await writeFile(path, `${JSON.stringify({ version: 2, processes }, null, 2)}\n`, 'utf8')
}

async function removeRuntimeForPid(pid: number): Promise<void> {
  const all = await readAllProcesses()
  const remaining = all.filter((p) => p.pid !== pid)
  if (remaining.length === all.length) return
  if (remaining.length === 0) {
    await removeRuntime()
  } else {
    await writeAllProcesses(remaining)
  }
}

async function removeRuntime(): Promise<void> {
  await rm(runtimePath(), { force: true })
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isStoppableYorzProcess(entry: ProcessEntry, snapshot: ProcessSnapshot): boolean {
  if (!hasRuntimeIdentity(entry)) return true
  return isTrustedYorzProcess(entry, snapshot)
}

function hasRuntimeIdentity(entry: ProcessEntry): boolean {
  return Boolean(entry.execPath || entry.argv || entry.processStartedAt)
}

function isTrustedYorzProcess(entry: ProcessEntry, snapshot: ProcessSnapshot): boolean {
  if (!entry.processStartedAt || snapshot.processStartedAt !== entry.processStartedAt) return false
  if (!entry.execPath || !entry.argv) return false

  const required = [
    entry.execPath,
    entry.argv[1],
    'serve',
    '--foreground',
    '--record-runtime',
  ].filter((arg): arg is string => typeof arg === 'string' && arg.length > 0)
  const commandMatches = required.every((arg) => snapshot.commandLine.includes(arg))

  return commandMatches
}

async function readProcessSnapshot(pid: number): Promise<ProcessSnapshot | null> {
  if (!isProcessAlive(pid)) return null
  if (process.platform === 'win32') return readWindowsProcessSnapshot(pid)
  return readPosixProcessSnapshot(pid)
}

async function readPosixProcessSnapshot(pid: number): Promise<ProcessSnapshot | null> {
  try {
    const { stdout } = await execFileAsync('ps', [
      '-ww',
      '-p',
      String(pid),
      '-o',
      'lstart=',
      '-o',
      'command=',
    ])
    const line = stdout.trim()
    if (!line) return null
    const parts = line.match(/^(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+([\s\S]+)$/)
    if (!parts) return { commandLine: line }
    return { processStartedAt: parts[1], commandLine: parts[2] }
  } catch {
    return null
  }
}

async function readWindowsProcessSnapshot(pid: number): Promise<ProcessSnapshot | null> {
  try {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
      'if ($null -eq $p) { exit 1 }',
      '$p | Select-Object CommandLine,CreationDate | ConvertTo-Json -Compress',
    ].join('; ')
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ])
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
    const commandLine = typeof parsed.CommandLine === 'string' ? parsed.CommandLine : ''
    const processStartedAt =
      typeof parsed.CreationDate === 'string' ? parsed.CreationDate : undefined
    if (!commandLine) return null
    return { commandLine, processStartedAt }
  } catch {
    return null
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (!isProcessAlive(pid)) return true
    await sleep(100)
  }
  return !isProcessAlive(pid)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
