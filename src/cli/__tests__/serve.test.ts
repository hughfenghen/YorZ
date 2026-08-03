import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backgroundArgs,
  backgroundStdio,
  restartWorkerArgs,
  runStopServe,
  runtimePath,
} from '../serve.js'
import { STDIO_LOG_FILE, resolveLogDir } from '../../service/logger.js'

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
      '--skip-skill-check',
      '--record-runtime',
    ])
  })

  it('passes inherited options to the restart worker', () => {
    expect(
      restartWorkerArgs({
        port: 8081,
        open: true,
        cwd: '/tmp/project',
        noRegisterCwd: true,
      }),
    ).toEqual([
      'serve',
      'restart',
      '--worker',
      '--port',
      '8081',
      '--open',
      '--cwd',
      '/tmp/project',
      '--no-register-cwd',
      '--skip-skill-check',
    ])
  })

  it('routes background stdio into serve-stdio.log via file descriptors', async () => {
    await withYorzHome(async () => {
      const result = backgroundStdio()
      const stdioFile = join(resolveLogDir(), STDIO_LOG_FILE)
      expect(result.path).toBe(stdioFile)
      expect(Array.isArray(result.stdio)).toBe(true)
      const stdio = result.stdio as Array<number | string>
      expect(stdio[0]).toBe('ignore')
      expect(typeof stdio[1]).toBe('number')
      expect(stdio[1]).toBe(stdio[2])

      // the file exists and is truncated on open
      const st = await stat(stdioFile)
      expect(st.size).toBe(0)
      closeSync(stdio[1] as number)
    })
  })

  it('truncates serve-stdio.log on every start so it stays bounded', async () => {
    await withYorzHome(async () => {
      const first = backgroundStdio()
      closeSync((first.stdio as number[])[1]!)
      await writeFile(join(resolveLogDir(), STDIO_LOG_FILE), 'stale output'.repeat(100), 'utf8')

      const second = backgroundStdio()
      closeSync((second.stdio as number[])[1]!)
      const st = await stat(join(resolveLogDir(), STDIO_LOG_FILE))
      expect(st.size).toBe(0)
    })
  })

  it("falls back to 'ignore' when the log dir cannot be opened", async () => {
    await withYorzHome(async (home) => {
      // make the home dir read-only so `logs/` cannot be created
      await chmod(home, 0o500)
      try {
        const result = backgroundStdio()
        expect(result.stdio).toBe('ignore')
        expect(result.path).toBeNull()
      } finally {
        await chmod(home, 0o700)
      }
    })
  })

  it('reports not running when no runtime exists', async () => {
    await withYorzHome(async () => {
      const result = await runStopServe()
      expect(result.stopped).toBe(false)
      expect(result.message).toBe('YorZ Service is not running.')
    })
  })

  it('removes stale v1 runtime when the recorded pid is gone', async () => {
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
      expect(result.message).toContain('pid=999999999')
      await expect(readFile(runtimePath(), 'utf8')).rejects.toThrow()
    })
  })

  it('removes stale v2 runtime with multiple dead entries', async () => {
    await withYorzHome(async () => {
      await writeFile(
        runtimePath(),
        `${JSON.stringify(
          {
            version: 2,
            processes: [
              {
                pid: 999999998,
                port: 7423,
                url: 'http://localhost:7423/',
                startedAt: new Date().toISOString(),
              },
              {
                pid: 999999999,
                port: 7424,
                url: 'http://localhost:7424/',
                startedAt: new Date().toISOString(),
              },
            ],
          },
          null,
          2,
        )}\n`,
        'utf8',
      )

      const result = await runStopServe()
      expect(result.stopped).toBe(false)
      expect(result.message).toContain('removed stale runtime')
      expect(result.message).toContain('pid=999999998')
      expect(result.message).toContain('pid=999999999')
      await expect(readFile(runtimePath(), 'utf8')).rejects.toThrow()
    })
  })
})

async function withYorzHome(fn: (home: string) => Promise<void>): Promise<void> {
  const previous = process.env.YORZ_HOME
  const home = await mkdtemp(join(tmpdir(), 'yorz-serve-test-'))
  process.env.YORZ_HOME = home
  try {
    await fn(home)
  } finally {
    if (previous === undefined) delete process.env.YORZ_HOME
    else process.env.YORZ_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}
