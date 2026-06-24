import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { createApp } from './server.js'
import { ProjectRegistry } from './project-registry.js'
import { HEARTBEAT_INTERVAL_MS } from './routes/events.js'

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
  for (const p of projects) {
    console.log(`  - ${p.name} -> ${p.path}`)
  }
  console.log(`agent heartbeat enabled (interval=${HEARTBEAT_INTERVAL_MS / 1000}s)`)

  if (opts.open) await tryOpenBrowser(url)

  return {
    url,
    port: port.port,
    registry,
    async close() {
      await new Promise<void>((resolve, reject) => {
        port.server.close((err) => (err ? reject(err) : resolve()))
      })
      await registry.closeAll()
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
          const server = serve({ fetch: fetchHandler, port: tryPort }, (info: AddressInfo) => {
            resolve({ port: info.port, server })
          })
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
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') break
    }
  }
  throw lastErr ?? new Error(`failed to bind port near ${preferredPort}`)
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
