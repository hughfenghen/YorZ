import { describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { closeSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  backgroundArgs,
  backgroundStdio,
  restartWorkerArgs,
  runStopServe,
  runtimePath,
} from '../serve.js'
import { STDIO_LOG_FILE, resolveLogDir } from '../../service/logger.js'

const execFileAsync = promisify(execFile)

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

  it('stops a live process from an old runtime without identity fields', async () => {
    await withYorzHome(async () => {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        stdio: 'ignore',
      })

      try {
        await waitForPid(child.pid)
        await writeFile(
          runtimePath(),
          `${JSON.stringify(
            {
              version: 2,
              processes: [
                {
                  pid: child.pid,
                  port: 7423,
                  url: 'http://localhost:7423/',
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
        expect(result.stopped).toBe(true)
        expect(result.stoppedPids).toEqual([child.pid])
      } finally {
        if (child.pid) {
          try {
            process.kill(child.pid, 'SIGKILL')
          } catch {
            // The stop command is expected to terminate it first.
          }
        }
      }
    })
  })

  it('stops a live process only when the recorded command identity matches', async () => {
    await withYorzHome(async () => {
      const args = [
        '-e',
        'setTimeout(() => {}, 30000)',
        'serve',
        '--foreground',
        '--record-runtime',
      ]
      const child = spawn(process.execPath, args, {
        stdio: 'ignore',
      })

      try {
        await waitForPid(child.pid)
        const processStartedAt = await readProcessStartedAt(child.pid)
        await writeFile(
          runtimePath(),
          `${JSON.stringify(
            {
              version: 2,
              processes: [
                {
                  pid: child.pid,
                  port: 7423,
                  url: 'http://localhost:7423/',
                  startedAt: new Date().toISOString(),
                  execPath: process.execPath,
                  argv: [process.execPath, ...args],
                  processStartedAt,
                },
              ],
            },
            null,
            2,
          )}\n`,
          'utf8',
        )

        const result = await runStopServe()
        expect(result.stopped).toBe(true)
        expect(result.stoppedPids).toEqual([child.pid])
      } finally {
        if (child.pid) {
          try {
            process.kill(child.pid, 'SIGKILL')
          } catch {
            // The stop command is expected to terminate it first.
          }
        }
      }
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

async function readProcessStartedAt(pid: number | undefined): Promise<string> {
  if (!pid) throw new Error('child process did not get a pid')
  if (process.platform === 'win32') {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
      'if ($null -eq $p) { exit 1 }',
      '$p | Select-Object CreationDate | ConvertTo-Json -Compress',
    ].join('; ')
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ])
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>
    if (typeof parsed.CreationDate !== 'string') throw new Error('missing CreationDate')
    return parsed.CreationDate
  }

  const { stdout } = await execFileAsync('ps', ['-ww', '-p', String(pid), '-o', 'lstart='])
  const startedAt = stdout.trim()
  if (!startedAt) throw new Error('missing lstart')
  return startedAt
}

async function waitForPid(pid: number | undefined): Promise<void> {
  if (!pid) throw new Error('child process did not get a pid')
  const until = Date.now() + 3000
  while (Date.now() < until) {
    try {
      process.kill(pid, 0)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  throw new Error(`pid ${pid} did not become alive`)
}
