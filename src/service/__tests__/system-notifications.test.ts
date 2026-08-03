import { describe, expect, it } from 'vitest'
import {
  SystemNotificationCenter,
  compareVersions,
  resolveGlobalInstallCommand,
} from '../system-notifications.js'
import { createApp } from '../server.js'
import { ProjectRegistry } from '../project-registry.js'

describe('system notifications', () => {
  it('compares numeric semver versions', () => {
    expect(compareVersions('0.4.3', '0.4.2')).toBe(1)
    expect(compareVersions('0.4.2', '0.4.2')).toBe(0)
    expect(compareVersions('0.4.1', '0.4.2')).toBe(-1)
  })

  it('resolves global install command from the invoking package manager', () => {
    expect(resolveGlobalInstallCommand({ npm_config_user_agent: 'pnpm/10.0.0' })).toEqual({
      cmd: 'pnpm',
      args: ['add', '-g', '@yorz/cli@latest'],
    })
    expect(resolveGlobalInstallCommand({ npm_config_user_agent: 'bun/1.2.0' })).toEqual({
      cmd: 'bun',
      args: ['add', '-g', '@yorz/cli@latest'],
    })
    expect(resolveGlobalInstallCommand({ npm_config_user_agent: 'yarn/1.22.0' })).toEqual({
      cmd: 'yarn',
      args: ['global', 'add', '@yorz/cli@latest'],
    })
    expect(resolveGlobalInstallCommand({})).toEqual({
      cmd: 'npm',
      args: ['install', '-g', '@yorz/cli@latest'],
    })
  })

  it('upserts one version notification and deletes it', () => {
    const center = new SystemNotificationCenter()
    center.upsertVersionUpdate({ current: '0.4.2', latest: '0.4.3' })
    center.upsertVersionUpdate({ current: '0.4.2', latest: '0.4.4' })

    const items = center.list()
    expect(items).toHaveLength(1)
    expect(items[0]!.metadata?.latestVersion).toBe('0.4.4')
    expect(center.delete('version-update')).toBe(true)
    expect(center.list()).toHaveLength(0)
  })

  it('moves version update action to restart-ready after update succeeds', async () => {
    const center = new SystemNotificationCenter({ runUpdate: async () => {} })
    center.upsertVersionUpdate({ current: '0.4.2', latest: '0.4.3' })

    const item = await center.update('version-update')

    expect(item.action).toBe('restart-ready')
  })

  it('serves global notification routes', async () => {
    const center = new SystemNotificationCenter({ runUpdate: async () => {} })
    center.upsertVersionUpdate({ current: '0.4.2', latest: '0.4.3' })
    const app = createApp({ registry: new ProjectRegistry(), systemNotifications: center })

    const list = await app.request('/api/system-notifications')
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject([{ id: 'version-update' }])

    const update = await app.request('/api/system-notifications/version-update/update', {
      method: 'POST',
    })
    expect(update.status).toBe(200)
    expect(await update.json()).toMatchObject({ action: 'restart-ready' })

    const del = await app.request('/api/system-notifications/version-update', { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(center.list()).toHaveLength(0)
  })
})
