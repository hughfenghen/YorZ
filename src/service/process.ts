import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export interface BrowserOpenInvocation {
  /** 当前平台用于打开默认浏览器的真实可执行文件。 */
  command: string
  /** 直接传给可执行文件的参数，避免经过 shell 重新解析。 */
  args: string[]
}

/**
 * 仅在 Windows 隐藏后台子进程控制台，其他平台原样返回选项以保持既有行为。
 *
 * @param options 原始 child_process 选项。
 * @param platform 目标平台；默认使用当前 Node.js 运行平台，测试可显式传入。
 * @returns Windows 下附加 windowsHide 的新选项，其他平台返回原对象。
 */
export function withHiddenWindowsConsole<T extends { windowsHide?: boolean }>(
  options: T,
  platform: NodeJS.Platform = process.platform,
): T {
  if (platform !== 'win32') return options
  return { ...options, windowsHide: true }
}

/**
 * 执行无需交互且需要捕获文本输出的命令，Windows 下不会创建可见控制台。
 *
 * @param file 要执行的原生可执行文件。
 * @param args 不经过 shell 解析的参数列表。
 * @param options execFile 工作目录、编码等选项。
 * @returns 子进程的 UTF-8 标准输出与标准错误。
 */
export async function execFileWithoutWindow(
  file: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileP(file, args, withHiddenWindowsConsole(options))
  return { stdout: result.stdout, stderr: result.stderr }
}

/**
 * 启动无需新控制台的子进程，保留调用方指定的 stdio、detached 与环境变量语义。
 *
 * @param command 要执行的原生可执行文件。
 * @param args 不经过 shell 解析的参数列表。
 * @param options spawn 生命周期及输入输出选项。
 * @returns Node.js ChildProcess，供调用方继续监听错误、退出或执行 unref。
 */
export function spawnWithoutWindow(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(command, args, withHiddenWindowsConsole(options))
}

/**
 * 解析各平台打开默认浏览器所需的原生可执行文件，避免依赖 shell 内建命令。
 *
 * @param platform 目标 Node.js 平台。
 * @param url 需要在默认浏览器中打开的地址。
 * @returns 可直接交给 spawn 的命令和参数。
 */
export function resolveBrowserOpenInvocation(
  platform: NodeJS.Platform,
  url: string,
): BrowserOpenInvocation {
  if (platform === 'win32') return { command: 'explorer.exe', args: [url] }
  if (platform === 'darwin') return { command: 'open', args: [url] }
  return { command: 'xdg-open', args: [url] }
}
