import { Hono } from 'hono'
import {
  loadGlobalConfig,
  saveGlobalConfig,
  type GlobalAgentConfig,
  type SessionEndNotificationsConfig,
} from '../global-config.js'

interface PutBody {
  agent: GlobalAgentConfig
  notifications: {
    sessionEnd: SessionEndNotificationsConfig
  }
}

export function createGlobalConfigRoutes(globalConfigPath?: string): Hono {
  const app = new Hono()

  app.get('/global-config', async (c) => {
    const cfg = await loadGlobalConfig(globalConfigPath)
    return c.json({ agent: cfg.agent, notifications: cfg.notifications })
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
    await saveGlobalConfig(cfg, globalConfigPath)
    return c.json({ ok: true, config: { agent: cfg.agent, notifications: cfg.notifications } })
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
  return {
    agent: { defaultKind },
    notifications: { sessionEnd: { banner: s.banner, sound: s.sound } },
  }
}
