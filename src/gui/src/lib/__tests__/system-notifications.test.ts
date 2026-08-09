import { describe, expect, it } from 'vitest'
import { waitForNotificationReset } from '../system-notifications.js'
import type { SystemNotification } from '../api.js'

describe('waitForNotificationReset', () => {
  it('resolves immediately when the notification is already gone', async () => {
    const calls: string[] = []
    const ok = await waitForNotificationReset({
      id: 'version-update',
      list: async () => {
        calls.push('list')
        return []
      },
      sleep: async () => {
        calls.push('sleep')
      },
    })

    expect(ok).toBe(true)
    expect(calls).toEqual(['list'])
  })

  it('waits through restart connection errors until the notification disappears', async () => {
    const versionUpdate = notification('version-update')
    const responses: Array<SystemNotification[] | Error> = [
      [versionUpdate],
      new Error('service restarting'),
      [],
    ]
    const sleeps: number[] = []

    const ok = await waitForNotificationReset({
      id: 'version-update',
      intervalMs: 25,
      timeoutMs: 100,
      list: async () => {
        const next = responses.shift()
        if (next instanceof Error) throw next
        return next ?? []
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    expect(ok).toBe(true)
    expect(sleeps).toEqual([25, 25])
  })

  it('returns false after the timeout budget is exhausted', async () => {
    const sleeps: number[] = []
    const ok = await waitForNotificationReset({
      id: 'version-update',
      intervalMs: 50,
      timeoutMs: 100,
      list: async () => [notification('version-update')],
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })

    expect(ok).toBe(false)
    expect(sleeps).toEqual([50, 50])
  })
})

function notification(id: string): SystemNotification {
  return {
    id,
    kind: 'version-update',
    title: 'YorZ update available',
    message: 'YorZ update available',
    createdAt: 1,
    updatedAt: 1,
    action: 'restart-ready',
  }
}
