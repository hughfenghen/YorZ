import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { saveGlobalConfig } from '../global-config.js'
import { createSessionEndNotifier, type CommandRunner } from '../session-end-notifier.js'

async function tmpConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yorz-session-end-notifier-'))
  return join(dir, 'projects.json')
}

describe('session-end-notifier', () => {
  it('does nothing when both session end notifications are disabled', async () => {
    const fp = await tmpConfigPath()
    const calls: Array<[string, string[]]> = []
    const notify = createSessionEndNotifier({
      globalConfigPath: fp,
      platform: 'darwin',
      runCommand: async (cmd, args) => {
        calls.push([cmd, args])
      },
    })

    await notify()

    expect(calls).toEqual([])
  })

  it('runs macOS banner and sound commands when enabled', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: true, sound: true } },
      },
      fp,
    )
    const calls: Array<[string, string[]]> = []
    const notify = createSessionEndNotifier({
      globalConfigPath: fp,
      projectName: 'Demo Project',
      platform: 'darwin',
      runCommand: async (cmd, args) => {
        calls.push([cmd, args])
      },
    })

    await notify()

    expect(calls.map(([cmd]) => cmd).sort()).toEqual(['afplay', 'osascript'])
    expect(calls).toContainEqual([
      'osascript',
      ['-e', 'display notification "" with title "YorZ · Demo Project"'],
    ])
    expect(calls).toContainEqual(['afplay', ['/System/Library/Sounds/Submarine.aiff']])
  })

  it('uses the project name in Linux banner titles', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: true, sound: false } },
      },
      fp,
    )
    const calls: Array<[string, string[]]> = []
    const notify = createSessionEndNotifier({
      globalConfigPath: fp,
      projectName: 'YorZ',
      platform: 'linux',
      runCommand: async (cmd, args) => {
        calls.push([cmd, args])
      },
    })

    await notify()

    expect(calls).toEqual([['notify-send', ['YorZ · YorZ', '']]])
  })

  it('uses the project name in Windows banner titles', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: true, sound: false } },
      },
      fp,
    )
    const calls: Array<[string, string[]]> = []
    const notify = createSessionEndNotifier({
      globalConfigPath: fp,
      projectName: "O'Hara",
      platform: 'win32',
      runCommand: async (cmd, args) => {
        calls.push([cmd, args])
      },
    })

    await notify()

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('powershell.exe')
    expect(calls[0][1][3]).toContain("$n.ShowBalloonTip(5000, 'YorZ · O''Hara', ''")
  })

  it('falls back to the app title when project name is blank', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: true, sound: false } },
      },
      fp,
    )
    const calls: Array<[string, string[]]> = []
    const notify = createSessionEndNotifier({
      globalConfigPath: fp,
      projectName: '   ',
      platform: 'linux',
      runCommand: async (cmd, args) => {
        calls.push([cmd, args])
      },
    })

    await notify()

    expect(calls).toEqual([['notify-send', ['YorZ', '']]])
  })

  it('swallows command failures', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(
      {
        version: 1,
        projects: [],
        agent: { defaultKind: 'claude' },
        notifications: { sessionEnd: { banner: true, sound: false } },
      },
      fp,
    )
    const failingRunner: CommandRunner = async () => {
      throw new Error('missing command')
    }
    const notify = createSessionEndNotifier({
      globalConfigPath: fp,
      platform: 'linux',
      runCommand: failingRunner,
    })

    await expect(notify()).resolves.toBeUndefined()
  })
})
