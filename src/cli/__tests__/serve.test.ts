import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backgroundArgs, runStopServe, runtimePath } from '../serve.js'

describe('serve', () => {
  it('passes foreground and inherited options to the background child', () => {
    expect(
      backgroundArgs({
        port: 8080,
        open: true,
        cwd: '/tmp/project',
        noRegisterCwd: true,
      }),
    ).toEqual([
      '--foreground',
      '--port',
      '8080',
      '--open',
      '--cwd',
      '/tmp/project',
      '--no-register-cwd',
    ])
  })

  it('reports not running when no runtime exists', async () => {
    await withYorzHome(async () => {
      const result = await runStopServe()
      expect(result.stopped).toBe(false)
      expect(result.message).toBe('YorZ Service is not running.')
    })
  })

  it('removes stale runtime when the recorded pid is gone', async () => {
    await withYorzHome(async () => {
      await writeFile(
        runtimePath(),
        `${JSON.stringify(
          {
            version: 1,
            pid: 999999999,
            port: 7423,
            url: 'http://localhost:7423/',
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        'utf8',
      )

      const result = await runStopServe()
      expect(result.stopped).toBe(false)
      expect(result.message).toContain('removed stale runtime')
      await expect(readFile(runtimePath(), 'utf8')).rejects.toThrow()
    })
  })
})

async function withYorzHome(fn: () => Promise<void>): Promise<void> {
  const previous = process.env.YORZ_HOME
  const home = await mkdtemp(join(tmpdir(), 'yorz-serve-test-'))
  process.env.YORZ_HOME = home
  try {
    await fn()
  } finally {
    if (previous === undefined) delete process.env.YORZ_HOME
    else process.env.YORZ_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}
