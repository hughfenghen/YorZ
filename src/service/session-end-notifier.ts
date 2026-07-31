import { execFile } from 'node:child_process'
import { platform } from 'node:os'
import { promisify } from 'node:util'
import { loadGlobalConfig } from './global-config.js'

const execFileP = promisify(execFile)
const COMMAND_TIMEOUT_MS = 4000

export interface SessionEndNotifierOptions {
  globalConfigPath?: string
  projectName?: string
  runCommand?: CommandRunner
  platform?: NodeJS.Platform
}

export type CommandRunner = (cmd: string, args: string[]) => Promise<void>

export function createSessionEndNotifier(opts: SessionEndNotifierOptions = {}) {
  return async function notifySessionEnded(): Promise<void> {
    const cfg = await loadGlobalConfig(opts.globalConfigPath)
    const sessionEnd = cfg.notifications.sessionEnd
    if (!sessionEnd.banner && !sessionEnd.sound) return

    const os = opts.platform ?? platform()
    const run = opts.runCommand ?? defaultRunCommand
    const title = formatBannerTitle(opts.projectName)
    const tasks: Array<Promise<void>> = []
    if (sessionEnd.banner) tasks.push(showBanner(os, run, title))
    if (sessionEnd.sound) tasks.push(playSound(os, run))
    await Promise.all(tasks.map((task) => task.catch(() => {})))
  }
}

async function defaultRunCommand(cmd: string, args: string[]): Promise<void> {
  await execFileP(cmd, args, {
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  })
}

function formatBannerTitle(projectName?: string): string {
  const name = projectName?.trim()
  return name ? `YorZ · ${name}` : 'YorZ'
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function showBanner(os: NodeJS.Platform, run: CommandRunner, title: string): Promise<void> {
  if (os === 'darwin') {
    await run('osascript', ['-e', `display notification "" with title ${appleScriptString(title)}`])
    return
  }
  if (os === 'win32') {
    await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '$n = New-Object System.Windows.Forms.NotifyIcon',
        '$n.Icon = [System.Drawing.SystemIcons]::Information',
        '$n.Visible = $true',
        `$n.ShowBalloonTip(5000, ${powershellSingleQuoted(title)}, '', [System.Windows.Forms.ToolTipIcon]::Info)`,
        'Start-Sleep -Milliseconds 5500',
        '$n.Dispose()',
      ].join('; '),
    ])
    return
  }
  await run('notify-send', [title, ''])
}

async function playSound(os: NodeJS.Platform, run: CommandRunner): Promise<void> {
  if (os === 'darwin') {
    await run('afplay', ['/System/Library/Sounds/Submarine.aiff'])
    return
  }
  if (os === 'win32') {
    await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[console]::beep(440, 180)',
    ])
    return
  }
  for (const [cmd, args] of [
    ['paplay', ['/usr/share/sounds/freedesktop/stereo/complete.oga']],
    ['canberra-gtk-play', ['-i', 'complete']],
    ['aplay', ['/usr/share/sounds/alsa/Front_Center.wav']],
  ] as Array<[string, string[]]>) {
    try {
      await run(cmd, args)
      return
    } catch {
      // Try the next common Linux sound backend.
    }
  }
}
