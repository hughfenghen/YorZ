import { serve } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { SpecStore } from './spec-store.js'
import { SpecWatcher } from './watcher.js'
import { AgentRunner } from './agent.js'
import { TouchedFilesStore } from './touched-files.js'
import { AttachmentStore } from './attachment-store.js'
import { createApp } from './server.js'
import { HEARTBEAT_INTERVAL_MS } from './routes/events.js'

export interface ServeOptions {
  port?: number
  cwd?: string
  open?: boolean
  guiRoot?: string
}

export interface ServeHandle {
  url: string
  port: number
  close(): Promise<void>
}

const DEFAULT_PORT = 7423
const MAX_PORT_TRIES = 10

export async function start(opts: ServeOptions = {}): Promise<ServeHandle> {
  const cwd = opts.cwd ?? process.cwd()
  const watcher = new SpecWatcher({ cwd })
  const store = new SpecStore({
    cwd,
    onWrite: (path, mtime) => watcher.markSelfWrite(path, mtime),
  })
  const touched = new TouchedFilesStore({ cwd })
  const runner = new AgentRunner({ cwd, touched })
  const attachments = new AttachmentStore({ cwd })
  await store.ensureRoot()
  await attachments.ensureRoot()
  // Best-effort TTL sweep at startup; do not block boot on it.
  void attachments.cleanupExpired().catch(() => {})
  await watcher.start()

  const app = createApp({
    store,
    watcher,
    runner,
    touched,
    attachments,
    cwd,
    guiRoot: opts.guiRoot,
  })

  const port = await listen(app.fetch, opts.port ?? DEFAULT_PORT)
  const url = `http://localhost:${port.port}/`
  console.log(`YorZ Service ready at ${url}`)
  console.log(`agent heartbeat enabled (interval=${HEARTBEAT_INTERVAL_MS / 1000}s)`)

  if (opts.open) await tryOpenBrowser(url)

  return {
    url,
    port: port.port,
    async close() {
      await new Promise<void>((resolve, reject) => {
        port.server.close((err) => (err ? reject(err) : resolve()))
      })
      await watcher.close()
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
