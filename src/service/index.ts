import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { serve } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { createApp } from './server.js'
import { ProjectRegistry } from './project-registry.js'
import { HEARTBEAT_INTERVAL_MS } from './routes/events.js'
import { getLogger } from './logger.js'
import pkg from '../../package.json' with { type: 'json' }

export interface ServeOptions {
  port?: number
  /** Auto-register this directory if it has a `.yorz/` and is not already in the global list. */
  cwd?: string
  /** Disable cwd auto-registration. */
  noRegisterCwd?: boolean
  /** Override global config path (tests). */
  globalConfigPath?: string
  open?: boolean
  guiRoot?: string
}

export interface ServeHandle {
  url: string
  port: number
  registry: ProjectRegistry
  close(): Promise<void>
}

const DEFAULT_PORT = 7423
const MAX_PORT_TRIES = 10

const log = () => getLogger().child('serve')

export async function start(opts: ServeOptions = {}): Promise<ServeHandle> {
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
  const app = createApp({ registry, guiRoot: opts.guiRoot })

  const port = await listen(app.fetch, opts.port ?? DEFAULT_PORT)
  const url = `http://localhost:${port.port}/`
  console.log(`YorZ Service ready at ${url} (${projects.length} project${projects.length === 1 ? '' : 's'})`)
  for (const lanUrl of listLanUrls(port.port)) {
    console.log(`  LAN: ${lanUrl}`)
  }
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

  if (opts.open) await tryOpenBrowser(url)

  return {
    url,
    port: port.port,
    registry,
    async close() {
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
): Promise<{ port: number; server: ReturnType<typeof serve> }> {
  let lastErr: Error | null = null
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const tryPort = preferredPort + i
    try {
      return await new Promise<{ port: number; server: ReturnType<typeof serve> }>(
        (resolve, reject) => {
          const server = serve(
            { fetch: fetchHandler, port: tryPort, hostname: '0.0.0.0' },
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

function listLanUrls(port: number): string[] {
  const urls: string[] = []
  const ifaces = networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        urls.push(`http://${info.address}:${port}/`)
      }
    }
  }
  return urls
}

async function tryOpenBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process')
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref()
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

export function installGlobalErrorHandlers(): void {
  if (process.listenerCount('uncaughtException') > 0) return
  process.on('uncaughtException', (err) => {
    logCrash('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    logCrash('unhandledRejection', reason)
  })
}
