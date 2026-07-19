import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { start, type ServeHandle } from '../service/index.js'
import { resolveGlobalConfigDir } from '../service/global-config.js'
import { ensureSkillsInstalled } from './install.js'

export interface ServeCommandOptions {
  port?: number
  open?: boolean
  cwd?: string
  noRegisterCwd?: boolean
  foreground?: boolean
  /** Internal: skip the skill install/update check (set on the background child). */
  skipSkillCheck?: boolean
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
}

const DEFAULT_SERVE_PORT = 7423
const RUNTIME_FILE = 'runtime.json'
const START_LOCK_DIR = 'serve.lock'
const START_WAIT_MS = 5000

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
    open: opts.open,
    cwd: opts.cwd ?? process.cwd(),
    noRegisterCwd: opts.noRegisterCwd,
  })

  await upsertProcess({
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
  // The parent already ran the skill check and printed logs; the detached child
  // has stdio ignored, so skip the check to avoid a redundant install pass.
  args.push('--skip-skill-check')
  return args
}

async function ensureSkillsInstalledWithLog(cwd: string): Promise<void> {
  const results = await ensureSkillsInstalled({ home: homedir(), cwd })
  for (const r of results) {
    if (r.status === 'installed') {
      console.log(`[skill][${r.agent}] ${r.skill} installed: ${r.path}`)
    } else if (r.status === 'updated') {
      console.log(`[skill][${r.agent}] ${r.skill} updated: ${r.path}`)
    } else {
      console.log(`[skill][${r.agent}] ${r.skill} is up to date`)
    }
  }
}

export async function runStopServe(): Promise<StopServeResult> {
  const all = await readAllProcesses()
  if (all.length === 0) {
    return {
      stopped: false,
      stoppedPids: [],
      urls: [],
      message: 'YorZ Service is not running.',
    }
  }

  const alive = all.filter((p) => isProcessAlive(p.pid))
  const dead = all.filter((p) => !isProcessAlive(p.pid))

  if (alive.length === 0) {
    await removeRuntime()
    const deadPidList = dead.map((p) => `pid=${p.pid}`).join(', ')
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

  for (const proc of alive) {
    try {
      process.kill(proc.pid, 'SIGTERM')
    } catch {
      failedPids.push(proc.pid)
      continue
    }

    let stopped = await waitForProcessExit(proc.pid, 2000)
    if (!stopped) {
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

  const alive = all.filter((p) => isProcessAlive(p.pid))
  const dead = all.filter((p) => !isProcessAlive(p.pid))

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
