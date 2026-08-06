import { Hono } from 'hono'
import {
  loadGlobalConfig,
  DEFAULT_POWER,
  normalizeShortcuts,
  normalizeShortcutBinding,
  saveGlobalConfig,
  SHORTCUT_ACTION_IDS,
  type GlobalAgentConfig,
  type GlobalPowerConfig,
  type GlobalShortcutsConfig,
  type SessionEndNotificationsConfig,
} from '../global-config.js'
import { getPowerInhibitController, type PowerInhibitController } from '../power-inhibit.js'

interface PutBody {
  agent: GlobalAgentConfig
  notifications: {
    sessionEnd: SessionEndNotificationsConfig
  }
  shortcuts: GlobalShortcutsConfig
  power: GlobalPowerConfig
}

const POWER_INHIBIT_MOCK_SESSION_ID = 'manual-power-inhibit-test'

export function createGlobalConfigRoutes(
  globalConfigPath?: string,
  powerController: PowerInhibitController = getPowerInhibitController(globalConfigPath),
): Hono {
  const app = new Hono()

  app.get('/global-config', async (c) => {
    const cfg = await loadGlobalConfig(globalConfigPath)
    return c.json({
      agent: cfg.agent,
      notifications: cfg.notifications,
      shortcuts: cfg.shortcuts,
      power: cfg.power,
    })
  })

  app.put('/global-config', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const parsed = parseBody(raw)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)

    const cfg = await loadGlobalConfig(globalConfigPath)
    cfg.agent = parsed.agent
    cfg.notifications = parsed.notifications
    cfg.shortcuts = parsed.shortcuts
    cfg.power = parsed.power
    await saveGlobalConfig(cfg, globalConfigPath)
    await powerController.refresh()
    return c.json({
      ok: true,
      config: {
        agent: cfg.agent,
        notifications: cfg.notifications,
        shortcuts: cfg.shortcuts,
        power: cfg.power,
      },
    })
  })

  app.get('/global-config/power-mock', (c) => {
    return c.json({
      running: powerController.isSessionRunning(POWER_INHIBIT_MOCK_SESSION_ID),
    })
  })

  app.put('/global-config/power-mock', async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    if (!raw || typeof raw !== 'object') return c.json({ error: 'body must be an object' }, 400)
    const running = (raw as Record<string, unknown>).running
    if (typeof running !== 'boolean') {
      return c.json({ error: 'running must be a boolean' }, 400)
    }
    powerController.setSessionRunning(POWER_INHIBIT_MOCK_SESSION_ID, running)
    await powerController.refresh()
    return c.json({ running })
  })

  return app
}

function parseBody(value: unknown): PutBody | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'body must be an object' }
  const obj = value as Record<string, unknown>
  const agent = obj.agent
  if (!agent || typeof agent !== 'object') {
    return { error: 'agent must be an object' }
  }
  const agentObj = agent as Record<string, unknown>
  const defaultKind = agentObj.defaultKind
  if (defaultKind !== 'claude' && defaultKind !== 'opencode' && defaultKind !== 'codex') {
    return { error: 'agent.defaultKind must be claude | opencode | codex' }
  }
  const notifications = obj.notifications
  if (!notifications || typeof notifications !== 'object') {
    return { error: 'notifications must be an object' }
  }
  const n = notifications as Record<string, unknown>
  const sessionEnd = n.sessionEnd
  if (!sessionEnd || typeof sessionEnd !== 'object') {
    return { error: 'notifications.sessionEnd must be an object' }
  }
  const s = sessionEnd as Record<string, unknown>
  if (typeof s.banner !== 'boolean') {
    return { error: 'notifications.sessionEnd.banner must be a boolean' }
  }
  if (typeof s.sound !== 'boolean') {
    return { error: 'notifications.sessionEnd.sound must be a boolean' }
  }
  const shortcutsRaw = obj.shortcuts ?? {}
  if (typeof shortcutsRaw !== 'object') {
    return { error: 'shortcuts must be an object' }
  }
  const shortcutObj = shortcutsRaw as Record<string, unknown>
  for (const key of Object.keys(shortcutObj)) {
    if (!SHORTCUT_ACTION_IDS.includes(key as (typeof SHORTCUT_ACTION_IDS)[number])) {
      return { error: `unknown shortcut action: ${key}` }
    }
    const value = shortcutObj[key]
    if (value !== null && typeof value !== 'string') {
      return { error: `shortcuts.${key} must be a string or null` }
    }
    if (typeof value === 'string' && !normalizeShortcutBinding(value)) {
      return { error: `shortcuts.${key} is not a valid shortcut binding` }
    }
  }
  const powerRaw = obj.power ?? DEFAULT_POWER
  if (!powerRaw || typeof powerRaw !== 'object') return { error: 'power must be an object' }
  const p = powerRaw as Record<string, unknown>
  const inhibitWhenRunning = p.inhibitWhenRunning
  if (
    inhibitWhenRunning !== 'system-default' &&
    inhibitWhenRunning !== 'prevent-display-sleep' &&
    inhibitWhenRunning !== 'keep-system-awake'
  ) {
    return {
      error:
        'power.inhibitWhenRunning must be system-default | prevent-display-sleep | keep-system-awake',
    }
  }
  return {
    agent: { defaultKind },
    notifications: { sessionEnd: { banner: s.banner, sound: s.sound } },
    shortcuts: normalizeShortcuts(shortcutObj),
    power: { inhibitWhenRunning },
  }
}
