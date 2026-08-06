import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { isIP, type AddressInfo } from 'node:net'
import { createApp } from './server.js'
import { ProjectRegistry } from './project-registry.js'
import { stopAllCommandManagers, stopAllCommandManagersSync } from './command-manager.js'
import { HEARTBEAT_INTERVAL_MS } from './routes/events.js'
import { getLogger } from './logger.js'
import { SystemNotificationCenter } from './system-notifications.js'
import pkg from '../../package.json' with { type: 'json' }
import { resolveBrowserOpenInvocation, spawnWithoutWindow } from './process.js'

export interface ServeOptions {
  port?: number
  /** Bind address. Only loopback addresses are accepted because command APIs are unauthenticated. */
  host?: string
  /** Auto-register this directory if it has a `.yorz/` and is not already in the global list. */
  cwd?: string
  /** Disable cwd auto-registration. */
  noRegisterCwd?: boolean
  /** Override global config path (tests). */
  globalConfigPath?: string
  open?: boolean
  guiRoot?: string
  /** 当前 runtime 的本地停服令牌；未提供时不注册内部停服入口。 */
  shutdownToken?: string
  /** 令牌验证通过后触发的统一关闭流程。 */
  onShutdownRequest?: () => void
}

export interface ServeHandle {
  url: string
  port: number
  registry: ProjectRegistry
  systemNotifications: SystemNotificationCenter
  close(): Promise<void>
}

const DEFAULT_PORT = 7423
const MAX_PORT_TRIES = 10
export const DEFAULT_HOST = '127.0.0.1'

/** 判断监听地址是否严格限制在本机，避免未认证命令 API 暴露到网络。 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (normalized === 'localhost') return true
  if (isIP(normalized) === 4) return normalized.startsWith('127.')
  if (isIP(normalized) === 6) {
    return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1'
  }
  return false
}

const log = () => getLogger().child('serve')

export async function start(opts: ServeOptions = {}): Promise<ServeHandle> {
  const host = opts.host?.trim() || DEFAULT_HOST
  if (!isLoopbackHost(host)) {
    throw new Error(`host must be a loopback address: ${host}`)
  }

  const registry = new ProjectRegistry({ globalConfigPath: opts.globalConfigPath })

  const cwd = opts.cwd ?? process.cwd()
  if (!opts.noRegisterCwd && existsSync(join(cwd, '.yorz'))) {
    try {
      await registry.add(cwd)
    } catch {
      // best-effort
    }
  }

  const projects = await registry.list()
  const systemNotifications = new SystemNotificationCenter()
  systemNotifications.startVersionChecks()
  const app = createApp({
    registry,
    guiRoot: opts.guiRoot,
    systemNotifications,
    shutdown:
      opts.shutdownToken && opts.onShutdownRequest
        ? { token: opts.shutdownToken, request: opts.onShutdownRequest }
        : undefined,
  })

  const port = await listen(app.fetch, opts.port ?? DEFAULT_PORT, host)
  const url = `http://localhost:${port.port}/`
  console.log(
    `YorZ Service ready at ${url} (${projects.length} project${projects.length === 1 ? '' : 's'})`,
  )
  for (const p of projects) {
    console.log(`  - ${p.name} -> ${p.path}`)
  }
  console.log(`agent heartbeat enabled (interval=${HEARTBEAT_INTERVAL_MS / 1000}s)`)

  log().info('service ready', {
    pid: process.pid,
    port: port.port,
    url,
    projects: projects.length,
    node: process.version,
    cli: pkg.version,
    logFile: getLogger().filePath,
  })

  installGlobalErrorHandlers()
  installCommandExitGuard()

  if (opts.open) await tryOpenBrowser(url)

  return {
    url,
    port: port.port,
    registry,
    systemNotifications,
    async close() {
      systemNotifications.stopVersionChecks()
      // Commands are tied to this service's lifetime: stop them before the
      // registry (and its manager references) go away.
      await stopAllCommandManagers()
      await registry.closeAll()
      await new Promise<void>((resolve, reject) => {
        port.server.close((err) => (err ? reject(err) : resolve()))
        // `closeAllConnections` exists on http/https servers but not on the
        // HTTP/2 members of ServerType, so narrow instead of optional-calling.
        if ('closeAllConnections' in port.server) port.server.closeAllConnections()
      })
    },
  }
}

async function listen(
  fetchHandler: Parameters<typeof serve>[0]['fetch'],
  preferredPort: number,
  hostname: string,
): Promise<{ port: number; server: ReturnType<typeof serve> }> {
  let lastErr: Error | null = null
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const tryPort = preferredPort + i
    try {
      return await new Promise<{ port: number; server: ReturnType<typeof serve> }>(
        (resolve, reject) => {
          const server = serve(
            { fetch: fetchHandler, port: tryPort, hostname },
            (info: AddressInfo) => {
              resolve({ port: info.port, server })
            },
          )
          server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
              server.close(() => {})
              reject(err)
            } else {
              reject(err)
            }
          })
        },
      )
    } catch (err) {
      lastErr = err as Error
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE') {
        log().warn('port in use, retrying', { port: tryPort, attempt: i + 1, max: MAX_PORT_TRIES })
      } else {
        log().warn('listen failed', { port: tryPort, code, err: lastErr })
        break
      }
    }
  }
  const fatal = lastErr ?? new Error(`failed to bind port near ${preferredPort}`)
  log().error('failed to bind any port', { preferredPort, tries: MAX_PORT_TRIES, err: fatal })
  throw fatal
}

/**
 * 使用各平台原生启动器打开默认浏览器；失败属于非关键能力，不阻断 Service 启动。
 *
 * @param url Service 已监听成功的本地地址。
 * @returns 浏览器进程完成派生后结束，不等待浏览器生命周期。
 */
async function tryOpenBrowser(url: string): Promise<void> {
  const invocation = resolveBrowserOpenInvocation(process.platform, url)
  try {
    const child = spawnWithoutWindow(invocation.command, invocation.args, {
      stdio: 'ignore',
      detached: true,
    })
    // spawn 的 ENOENT 等错误是异步事件；吞掉它以保持 --open 的 best-effort 语义。
    child.once('error', () => {})
    child.unref()
  } catch {
    // best-effort, ignore failures
  }
}

/**
 * Crash lines now land in the shared, size-capped `serve.log` instead of the
 * unbounded `serve-errors.log`. Any pre-existing `serve-errors.log` is left on
 * disk untouched so we never destroy a user's evidence.
 */
function logCrash(kind: string, payload: unknown): void {
  const body = payload instanceof Error ? (payload.stack ?? payload.message) : String(payload)
  log().error(kind, { detail: body })
}

/**
 * Backstop for paths that never reach `close()` — an uncaught crash, or a
 * `process.exit()` from somewhere else. `exit` handlers cannot await, so this
 * only gets to send a synchronous SIGKILL to each command's process group.
 */
let commandExitGuardInstalled = false
export function installCommandExitGuard(): void {
  if (commandExitGuardInstalled) return
  commandExitGuardInstalled = true
  process.on('exit', () => {
    stopAllCommandManagersSync()
  })
}

export function installGlobalErrorHandlers(): void {
  if (process.listenerCount('uncaughtException') > 0) return
  process.on('uncaughtException', (err) => {
    logCrash('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    logCrash('unhandledRejection', reason)
  })
}
