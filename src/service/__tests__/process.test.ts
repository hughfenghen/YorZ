import { describe, expect, it } from 'vitest'
import {
  execFileWithoutWindow,
  resolveBrowserOpenInvocation,
  spawnWithoutWindow,
  withHiddenWindowsConsole,
} from '../process.js'

describe('withHiddenWindowsConsole', () => {
  it('hides the child console on Windows while preserving existing options', () => {
    const options = { detached: true, stdio: 'ignore' as const }

    expect(withHiddenWindowsConsole(options, 'win32')).toEqual({
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
  })

  it.each(['darwin', 'linux'] as const)(
    'leaves child-process options unchanged on %s',
    (platform) => {
      const options = { detached: true, stdio: 'ignore' as const }

      expect(withHiddenWindowsConsole(options, platform)).toBe(options)
      expect(options).not.toHaveProperty('windowsHide')
    },
  )
})

describe('non-interactive child processes', () => {
  it('executes a file and captures UTF-8 output', async () => {
    const result = await execFileWithoutWindow(
      process.execPath,
      ['-e', 'process.stdout.write("ok")'],
      { encoding: 'utf8' },
    )

    expect(result.stdout).toBe('ok')
    expect(result.stderr).toBe('')
  })

  it('spawns a child without changing its exit behavior', async () => {
    const child = spawnWithoutWindow(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    })

    const exitCode = await new Promise<number | null>((resolve) => {
      child.once('exit', resolve)
    })
    expect(exitCode).toBe(0)
  })
})

describe('resolveBrowserOpenInvocation', () => {
  it.each([
    ['win32', 'explorer.exe'],
    ['darwin', 'open'],
    ['linux', 'xdg-open'],
  ] as const)('uses the native browser launcher on %s', (platform, command) => {
    expect(resolveBrowserOpenInvocation(platform, 'http://localhost:7423/')).toEqual({
      command,
      args: ['http://localhost:7423/'],
    })
  })
})
