import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { start } from '../index.js'

describe('内部停服接口', () => {
  it('only accepts the runtime shutdown token before invoking cleanup', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-shutdown-'))
    const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-shutdown-cfg-'))
    let requested = false
    const handle = await start({
      cwd,
      port: 0,
      noRegisterCwd: true,
      globalConfigPath: join(cfgDir, 'config.json'),
      shutdownToken: 'runtime-secret',
      onShutdownRequest: () => {
        requested = true
      },
    })

    try {
      const endpoint = `${handle.url}api/internal/shutdown`
      const rejected = await fetch(endpoint, { method: 'POST' })
      expect(rejected.status).toBe(403)
      expect(requested).toBe(false)

      const accepted = await fetch(endpoint, {
        method: 'POST',
        headers: { 'x-yorz-shutdown-token': 'runtime-secret' },
      })
      expect(accepted.status).toBe(202)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(requested).toBe(true)
    } finally {
      await handle.close()
      await Promise.all([
        rm(cwd, { recursive: true, force: true }),
        rm(cfgDir, { recursive: true, force: true }),
      ])
    }
  })
})
