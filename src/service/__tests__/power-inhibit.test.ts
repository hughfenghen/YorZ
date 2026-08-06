import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { saveGlobalConfig } from '../global-config.js'
import { PowerInhibitController, type PowerInhibitProcess } from '../power-inhibit.js'

async function tmpConfigPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yorz-power-inhibit-'))
  return join(dir, 'projects.json')
}

function baseConfig(mode: 'system-default' | 'prevent-display-sleep' | 'keep-system-awake') {
  return {
    version: 1 as const,
    projects: [],
    agent: { defaultKind: 'claude' as const },
    notifications: { sessionEnd: { banner: false, sound: false } },
    shortcuts: {},
    power: { inhibitWhenRunning: mode },
  }
}

describe('PowerInhibitController', () => {
  it('starts macOS display sleep inhibition with caffeinate -d', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(baseConfig('prevent-display-sleep'), fp)
    const calls: Array<{ command: string; args: string[] }> = []
    const controller = new PowerInhibitController({
      globalConfigPath: fp,
      platform: 'darwin',
      spawnCommand: (command, args) => {
        calls.push({ command, args })
        return { kill: () => true, unref: () => {} }
      },
    })

    controller.setSessionRunning('s1', true)
    await controller.refresh()

    expect(calls).toEqual([{ command: 'caffeinate', args: ['-d'] }])
  })

  it('starts macOS system awake inhibition with caffeinate -i', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(baseConfig('keep-system-awake'), fp)
    const calls: Array<{ command: string; args: string[] }> = []
    const controller = new PowerInhibitController({
      globalConfigPath: fp,
      platform: 'darwin',
      spawnCommand: (command, args) => {
        calls.push({ command, args })
        return { kill: () => true, unref: () => {} }
      },
    })

    controller.setSessionRunning('s1', true)
    await controller.refresh()

    expect(calls).toEqual([{ command: 'caffeinate', args: ['-i'] }])
  })

  it('releases the inhibit process when no sessions are running', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(baseConfig('keep-system-awake'), fp)
    const processes: Array<PowerInhibitProcess & { killed: boolean }> = []
    const controller = new PowerInhibitController({
      globalConfigPath: fp,
      platform: 'darwin',
      spawnCommand: () => {
        const proc = {
          killed: false,
          kill() {
            proc.killed = true
            return true
          },
          unref() {},
        }
        processes.push(proc)
        return proc
      },
    })

    controller.setSessionRunning('s1', true)
    await controller.refresh()
    controller.setSessionRunning('s1', false)
    await controller.refresh()

    expect(processes).toHaveLength(1)
    expect(processes[0]!.killed).toBe(true)
  })

  it('does not spawn on unsupported platforms', async () => {
    const fp = await tmpConfigPath()
    await saveGlobalConfig(baseConfig('keep-system-awake'), fp)
    const calls: string[] = []
    const controller = new PowerInhibitController({
      globalConfigPath: fp,
      platform: 'linux',
      spawnCommand: (command) => {
        calls.push(command)
        return { kill: () => true }
      },
    })

    controller.setSessionRunning('s1', true)
    await controller.refresh()

    expect(calls).toEqual([])
  })
})
