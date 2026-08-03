import { spawn } from 'node:child_process'
import pkg from '../../package.json' with { type: 'json' }
import { getLogger } from './logger.js'

export type SystemNotificationKind = 'version-update'
export type SystemNotificationAction = 'none' | 'update-available' | 'updating' | 'restart-ready'

export interface SystemNotification {
  id: string
  kind: SystemNotificationKind
  title: string
  message: string
  createdAt: number
  updatedAt: number
  action: SystemNotificationAction
  metadata?: Record<string, string>
}

export interface VersionInfo {
  current: string
  latest: string
}

export interface SystemNotificationCenterOptions {
  runUpdate?: () => Promise<void>
  runRestart?: () => Promise<void>
  fetchLatestVersion?: () => Promise<string | null>
}

type Listener = () => void

const VERSION_NOTIFICATION_ID = 'version-update'
export const VERSION_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000

const log = () => getLogger().child('system-notifications')

export class SystemNotificationCenter {
  private items = new Map<string, SystemNotification>()
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setInterval> | null = null
  private checking = false

  constructor(private opts: SystemNotificationCenterOptions = {}) {}

  list(): SystemNotification[] {
    return [...this.items.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  delete(id: string): boolean {
    const deleted = this.items.delete(id)
    if (deleted) this.emit()
    return deleted
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  upsertVersionUpdate(info: VersionInfo): SystemNotification {
    const now = Date.now()
    const current = this.items.get(VERSION_NOTIFICATION_ID)
    const next: SystemNotification = {
      id: VERSION_NOTIFICATION_ID,
      kind: 'version-update',
      title: 'YorZ update available',
      message: `YorZ ${info.latest} is available. Current version: ${info.current}.`,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      action: current?.action === 'restart-ready' ? 'restart-ready' : 'update-available',
      metadata: { currentVersion: info.current, latestVersion: info.latest },
    }
    this.items.set(next.id, next)
    this.emit()
    return next
  }

  async update(id: string): Promise<SystemNotification> {
    const item = this.requireVersionNotification(id)
    this.setAction(item.id, 'updating')
    try {
      await (this.opts.runUpdate ?? defaultRunUpdate)()
      return this.setAction(item.id, 'restart-ready')
    } catch (err) {
      const current = this.requireVersionNotification(id)
      const next = {
        ...current,
        action: 'update-available' as const,
        updatedAt: Date.now(),
        metadata: {
          ...(current.metadata ?? {}),
          error: err instanceof Error ? err.message : String(err),
        },
      }
      this.items.set(id, next)
      this.emit()
      throw err
    }
  }

  async restart(id: string): Promise<SystemNotification> {
    const item = this.requireVersionNotification(id)
    if (item.action !== 'restart-ready') throw new Error('restart is not ready')
    await (this.opts.runRestart ?? defaultRunRestart)()
    return item
  }

  startVersionChecks(intervalMs: number = VERSION_CHECK_INTERVAL_MS): void {
    if (this.timer) return
    void this.checkVersion()
    this.timer = setInterval(() => void this.checkVersion(), intervalMs)
    this.timer.unref?.()
  }

  stopVersionChecks(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async checkVersion(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const latest = await (this.opts.fetchLatestVersion ?? fetchLatestVersion)()
      if (!latest) return
      const current = pkg.version
      if (compareVersions(latest, current) > 0) {
        this.upsertVersionUpdate({ current, latest })
      }
    } catch (err) {
      log().warn('version check failed', { err })
    } finally {
      this.checking = false
    }
  }

  private requireVersionNotification(id: string): SystemNotification {
    const item = this.items.get(id)
    if (!item) throw new Error('notification not found')
    if (item.kind !== 'version-update') throw new Error('notification has no update action')
    return item
  }

  private setAction(id: string, action: SystemNotificationAction): SystemNotification {
    const item = this.requireVersionNotification(id)
    const next = { ...item, action, updatedAt: Date.now() }
    this.items.set(id, next)
    this.emit()
    return next
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // listeners must not break store updates
      }
    }
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    const diff = pa[i]! - pb[i]!
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export interface GlobalInstallCommand {
  cmd: 'npm' | 'pnpm' | 'bun' | 'yarn'
  args: string[]
}

type PackageManagerEnv = Partial<Record<'npm_config_user_agent' | 'npm_execpath', string>>

export function resolveGlobalInstallCommand(
  env: PackageManagerEnv = process.env,
): GlobalInstallCommand {
  const source = `${env.npm_config_user_agent ?? ''} ${env.npm_execpath ?? ''}`.toLowerCase()
  const manager = source.includes('pnpm')
    ? 'pnpm'
    : source.includes('bun')
      ? 'bun'
      : source.includes('yarn')
        ? 'yarn'
        : 'npm'

  switch (manager) {
    case 'pnpm':
      return { cmd: 'pnpm', args: ['add', '-g', '@yorz/cli@latest'] }
    case 'bun':
      return { cmd: 'bun', args: ['add', '-g', '@yorz/cli@latest'] }
    case 'yarn':
      return { cmd: 'yarn', args: ['global', 'add', '@yorz/cli@latest'] }
    default:
      return { cmd: 'npm', args: ['install', '-g', '@yorz/cli@latest'] }
  }
}

function parseVersion(value: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

async function fetchLatestVersion(): Promise<string | null> {
  const res = await fetch('https://registry.npmjs.org/@yorz/cli/latest')
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`)
  const body = (await res.json()) as { version?: unknown }
  return typeof body.version === 'string' ? body.version : null
}

function defaultRunUpdate(): Promise<void> {
  const install = resolveGlobalInstallCommand()
  return runProcess(install.cmd, install.args)
}

function defaultRunRestart(): Promise<void> {
  const entry = process.argv[1]
  if (!entry) throw new Error('Cannot resolve CLI entrypoint for restart')
  const child = spawn(process.execPath, [entry, 'serve', 'restart'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return Promise.resolve()
}

function runProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with ${code ?? signal ?? 'unknown'}`))
    })
  })
}
