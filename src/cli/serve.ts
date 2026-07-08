import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { start, type ServeHandle } from '../service/index.js'
import { resolveGlobalConfigDir } from '../service/global-config.js'

export interface ServeCommandOptions {
  port?: number
  open?: boolean
  cwd?: string
  noRegisterCwd?: boolean
  foreground?: boolean
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
  pid?: number
  url?: string
  message: string
}

export interface RuntimeInfo {
  version: 1
  pid: number
  port: number
  url: string
  startedAt: string
}

const DEFAULT_SERVE_PORT = 7423
const RUNTIME_FILE = 'runtime.json'
const START_LOCK_DIR = 'serve.lock'
const START_WAIT_MS = 5000

export async function runServe(
  opts: ServeCommandOptions,
): Promise<ServeHandle | BackgroundServeResult> {
  if (!opts.foreground) {
    return startBackgroundServe(opts)
  }

  const handle = await start({
    port: opts.port,
    open: opts.open,
    cwd: opts.cwd ?? process.cwd(),
    noRegisterCwd: opts.noRegisterCwd,
  })

  await writeRuntime({
    version: 1,
    pid: process.pid,
    port: handle.port,
    url: handle.url,
    startedAt: new Date().toISOString(),
  })
  console.log(`Stop with: yorz serve stop`)

  const shutdown = async () => {
    console.log('\nShutting down YorZ Service…')
    try {
      await handle.close()
    } finally {
      await removeRuntimeForPid(process.pid)
      process.exit(0)
    }
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  return handle
}

function startBackgroundServe(opts: ServeCommandOptions): Promise<BackgroundServeResult> {
  return withStartLock(async () => {
    const existing = await readLiveRuntime()
    if (existing) {
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

    const child = spawn(process.execPath, [entry, 'serve', ...backgroundArgs(opts)], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()

    const runtime = await waitForRuntime(child.pid, START_WAIT_MS)
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
  if (opts.open) args.push('--open')
  if (opts.cwd) args.push('--cwd', opts.cwd)
  if (opts.noRegisterCwd) args.push('--no-register-cwd')
  return args
}

export async function runStopServe(): Promise<StopServeResult> {
  const runtime = await readRuntime()
  if (!runtime) {
    return {
      stopped: false,
      message: 'YorZ Service is not running.',
    }
  }

  if (!isProcessAlive(runtime.pid)) {
    await removeRuntime()
    return {
      stopped: false,
      pid: runtime.pid,
      url: runtime.url,
      message: `YorZ Service was not running; removed stale runtime for pid=${runtime.pid}.`,
    }
  }

  try {
    process.kill(runtime.pid, 'SIGTERM')
  } catch (err) {
    await removeRuntime()
    return {
      stopped: false,
      pid: runtime.pid,
      url: runtime.url,
      message: `Failed to stop YorZ Service pid=${runtime.pid}: ${(err as Error).message}`,
    }
  }

  let stopped = await waitForProcessExit(runtime.pid, 2000)
  if (!stopped) {
    try {
      process.kill(runtime.pid, 'SIGKILL')
    } catch {
      // It may have exited between the final poll and SIGKILL.
    }
    stopped = await waitForProcessExit(runtime.pid, 2000)
  }
  if (stopped) await removeRuntime()
  return {
    stopped,
    pid: runtime.pid,
    url: runtime.url,
    message: stopped
      ? `Stopped YorZ Service (pid=${runtime.pid}).`
      : `Tried to stop YorZ Service (pid=${runtime.pid}), but it is still running.`,
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

async function waitForLiveRuntime(timeoutMs: number): Promise<RuntimeInfo | null> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const runtime = await readLiveRuntime()
    if (runtime) return runtime
    await sleep(100)
  }
  return null
}

async function waitForRuntime(pid: number | undefined, timeoutMs: number): Promise<RuntimeInfo | null> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const runtime = await readLiveRuntime()
    if (runtime && (pid === undefined || runtime.pid === pid)) return runtime
    await sleep(100)
  }
  return null
}

async function readLiveRuntime(): Promise<RuntimeInfo | null> {
  const runtime = await readRuntime()
  if (!runtime) return null
  if (isProcessAlive(runtime.pid)) return runtime
  await removeRuntime()
  return null
}

async function readRuntime(): Promise<RuntimeInfo | null> {
  const path = runtimePath()
  if (!existsSync(path)) return null
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<RuntimeInfo>
    if (
      parsed.version !== 1 ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.url !== 'string' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null
    }
    return parsed as RuntimeInfo
  } catch {
    return null
  }
}

async function writeRuntime(runtime: RuntimeInfo): Promise<void> {
  const path = runtimePath()
  await mkdir(resolveGlobalConfigDir(), { recursive: true })
  await writeFile(path, `${JSON.stringify(runtime, null, 2)}\n`, 'utf8')
}

async function removeRuntimeForPid(pid: number): Promise<void> {
  const runtime = await readRuntime()
  if (!runtime || runtime.pid === pid) await removeRuntime()
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
