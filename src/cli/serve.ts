import { start, type ServeHandle } from '../service/index.js'

export interface ServeCommandOptions {
  port?: number
  open?: boolean
  cwd?: string
  noRegisterCwd?: boolean
}

export async function runServe(opts: ServeCommandOptions): Promise<ServeHandle> {
  const handle = await start({
    port: opts.port,
    open: opts.open,
    cwd: opts.cwd ?? process.cwd(),
    noRegisterCwd: opts.noRegisterCwd,
  })

  const shutdown = async () => {
    console.log('\nShutting down YorZ Service…')
    try {
      await handle.close()
    } finally {
      process.exit(0)
    }
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  return handle
}
