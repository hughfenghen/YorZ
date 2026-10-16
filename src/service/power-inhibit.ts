import { spawn, type ChildProcess } from 'node:child_process'
import { platform as osPlatform } from 'node:os'
import {
  loadGlobalConfig,
  resolveGlobalConfigPath,
  type PowerInhibitMode,
} from './global-config.js'
import { getLogger } from './logger.js'
import { withHiddenWindowsConsole } from './process.js'

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
  /**
   * YorZ 服务进程 pid；helper 进程在 OS 层绑定此 pid 的存活。一旦 YorZ 进程
   * 以任何方式退出（正常关闭、崩溃、SIGTERM/SIGINT、SIGKILL、系统杀死），
   * helper 会自行退出并还原电源管理状态——不依赖 YorZ 显式 kill。默认 `process.pid`。
   */
  watchPid?: number
}

const powerLog = () => getLogger().child('power')
const controllers = new Map<string, PowerInhibitController>()

export class PowerInhibitController {
  private readonly globalConfigPath?: string
  private readonly platform: NodeJS.Platform
  private readonly spawnCommand: PowerInhibitSpawn
  private readonly watchPid: number
  private readonly runningSessions = new Set<string>()
  private currentMode: PowerInhibitMode = 'system-default'
  private process: PowerInhibitProcess | null = null
  private refreshPromise: Promise<void> = Promise.resolve()

  constructor(opts: PowerInhibitControllerOptions = {}) {
    this.globalConfigPath = opts.globalConfigPath
    this.platform = opts.platform ?? osPlatform()
    this.watchPid = opts.watchPid ?? process.pid
    this.spawnCommand =
      opts.spawnCommand ??
      // win32 下经 withHiddenWindowsConsole 附加 windowsHide，避免 PowerShell 弹出可见控制台。
      ((command, args, options) =>
        spawn(command, args, withHiddenWindowsConsole(options, this.platform)) as ChildProcess)
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

    const command = this.commandFor(mode)
    if (!command) {
      powerLog().debug('power inhibit mode ignored on unsupported platform', {
        mode,
        platform: this.platform,
      })
      return
    }

    const child = this.spawnCommand(command.command, command.args, { stdio: 'ignore' })
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
    powerLog().debug('started power inhibit process', {
      mode,
      command: command.command,
      args: command.args,
    })
  }

  private commandFor(mode: Exclude<PowerInhibitMode, 'system-default'>): {
    command: string
    args: string[]
  } | null {
    if (this.platform === 'darwin') {
      // `-w <pid>`：caffeinate 在被监视进程退出时自动结束。覆盖 YorZ 崩溃 /
      // 被 SIGKILL / 系统杀死等无法在 YorZ 内部执行清理的场景。
      const assert = mode === 'prevent-display-sleep' ? '-d' : '-i'
      return {
        command: 'caffeinate',
        args: [assert, '-w', String(this.watchPid)],
      }
    }
    if (this.platform === 'linux') {
      // systemd-inhibit 持锁期间运行其子命令；子命令退出即释放锁。用一个轮询
      // YorZ pid 的 shell 循环替代 `sleep infinity`：YorZ 一旦消失，`kill -0`
      // 失败 → 循环退出 → systemd-inhibit 释放抑制锁并退出。
      return {
        command: 'systemd-inhibit',
        args: [
          `--what=${mode === 'prevent-display-sleep' ? 'idle' : 'idle:sleep'}`,
          '--why=YorZ agent task running',
          'sh',
          '-c',
          `while kill -0 ${this.watchPid} 2>/dev/null; do sleep 2; done`,
        ],
      }
    }
    if (this.platform === 'win32') {
      const flags = mode === 'prevent-display-sleep' ? '0x80000002' : '0x80000001'
      return {
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          windowsExecutionStateScript(flags, this.watchPid),
        ],
      }
    }
    return null
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

function windowsExecutionStateScript(flags: string, watchPid: number): string {
  // 轮询 YorZ 进程：一旦它消失（崩溃 / 被结束 / 系统杀死），跳出循环，由
  // finally 调用 SetThreadExecutionState(ES_CONTINUOUS) 复位电源请求，helper 自退。
  // 即便本 PowerShell 进程自身被强杀，Windows 也会在进程退出时清除 ES_CONTINUOUS。
  return [
    '$signature = \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);\';',
    '$native = Add-Type -MemberDefinition $signature -Name YorZPowerInhibit -Namespace YorZ -PassThru;',
    'try {',
    `  [void]$native::SetThreadExecutionState(${flags});`,
    '  while ($true) {',
    `    if ($null -eq (Get-Process -Id ${watchPid} -ErrorAction SilentlyContinue)) { break; }`,
    '    Start-Sleep -Seconds 2;',
    '  }',
    '} finally {',
    '  [void]$native::SetThreadExecutionState(0x80000000);',
    '}',
  ].join(' ')
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
