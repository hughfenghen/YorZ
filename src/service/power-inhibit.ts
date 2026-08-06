import { spawn, type ChildProcess } from 'node:child_process'
import { platform as osPlatform } from 'node:os'
import {
  loadGlobalConfig,
  resolveGlobalConfigPath,
  type PowerInhibitMode,
} from './global-config.js'
import { getLogger } from './logger.js'

export interface PowerInhibitProcess {
  kill(signal?: NodeJS.Signals | number): boolean
  unref?(): void
  on?(event: 'error', listener: (err: Error) => void): PowerInhibitProcess
  on?(event: 'exit', listener: () => void): PowerInhibitProcess
}

export type PowerInhibitSpawn = (
  command: string,
  args: string[],
  options: { stdio: 'ignore' },
) => PowerInhibitProcess

export interface PowerInhibitControllerOptions {
  globalConfigPath?: string
  platform?: NodeJS.Platform
  spawnCommand?: PowerInhibitSpawn
}

const powerLog = () => getLogger().child('power')
const controllers = new Map<string, PowerInhibitController>()

export class PowerInhibitController {
  private readonly globalConfigPath?: string
  private readonly platform: NodeJS.Platform
  private readonly spawnCommand: PowerInhibitSpawn
  private readonly runningSessions = new Set<string>()
  private currentMode: PowerInhibitMode = 'system-default'
  private process: PowerInhibitProcess | null = null
  private refreshPromise: Promise<void> = Promise.resolve()

  constructor(opts: PowerInhibitControllerOptions = {}) {
    this.globalConfigPath = opts.globalConfigPath
    this.platform = opts.platform ?? osPlatform()
    this.spawnCommand =
      opts.spawnCommand ??
      ((command, args, options) => spawn(command, args, options) as ChildProcess)
  }

  setSessionRunning(sessionId: string, running: boolean): void {
    if (running) this.runningSessions.add(sessionId)
    else this.runningSessions.delete(sessionId)
    this.scheduleRefresh()
  }

  async refresh(): Promise<void> {
    const cfg = await loadGlobalConfig(this.globalConfigPath)
    const mode = this.runningSessions.size > 0 ? cfg.power.inhibitWhenRunning : 'system-default'
    this.applyMode(mode)
  }

  dispose(): void {
    this.runningSessions.clear()
    this.applyMode('system-default')
  }

  private scheduleRefresh(): void {
    this.refreshPromise = this.refreshPromise
      .catch(() => {})
      .then(() => this.refresh())
      .catch((err) => {
        powerLog().warn('failed to refresh power inhibit state', {
          message: err instanceof Error ? err.message : String(err),
        })
      })
  }

  private applyMode(mode: PowerInhibitMode): void {
    if (mode === this.currentMode) return
    this.stopCurrent()
    this.currentMode = mode
    if (mode === 'system-default') return

    if (this.platform !== 'darwin') {
      powerLog().debug('power inhibit mode ignored on unsupported platform', {
        mode,
        platform: this.platform,
      })
      return
    }

    const args = mode === 'prevent-display-sleep' ? ['-d'] : ['-i']
    const child = this.spawnCommand('caffeinate', args, { stdio: 'ignore' })
    child.on?.('error', (err) => {
      if (this.process === child) {
        this.process = null
        this.currentMode = 'system-default'
      }
      powerLog().warn('power inhibit process failed', { message: err.message })
    })
    child.on?.('exit', () => {
      if (this.process === child) {
        this.process = null
        this.currentMode = 'system-default'
      }
    })
    child.unref?.()
    this.process = child
    powerLog().debug('started power inhibit process', { mode, command: 'caffeinate', args })
  }

  private stopCurrent(): void {
    if (!this.process) return
    try {
      this.process.kill()
    } catch {
      // best-effort cleanup
    } finally {
      this.process = null
    }
  }
}

export function getPowerInhibitController(globalConfigPath?: string): PowerInhibitController {
  const key = globalConfigPath ?? resolveGlobalConfigPath()
  let controller = controllers.get(key)
  if (!controller) {
    controller = new PowerInhibitController({ globalConfigPath })
    controllers.set(key, controller)
  }
  return controller
}
