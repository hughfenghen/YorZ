import { Hono } from 'hono'
import {
  loadGlobalConfig,
  DEFAULT_APPEARANCE,
  DEFAULT_POWER,
  normalizeShortcuts,
  normalizeShortcutBinding,
  saveGlobalConfig,
  SHORTCUT_ACTION_IDS,
  isLanguage,
  isThemeMode,
  isThemeName,
  type GlobalAppearanceConfig,
  type GlobalAgentConfig,
  type GlobalCustomInstruction,
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
  appearance: GlobalAppearanceConfig
  customInstructions: GlobalCustomInstruction[]
}

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
      appearance: cfg.appearance,
      customInstructions: cfg.customInstructions,
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
    cfg.appearance = parsed.appearance
    cfg.customInstructions = parsed.customInstructions
    await saveGlobalConfig(cfg, globalConfigPath)
    await powerController.refresh()
    return c.json({
      ok: true,
      config: {
        agent: cfg.agent,
        notifications: cfg.notifications,
        shortcuts: cfg.shortcuts,
        power: cfg.power,
        appearance: cfg.appearance,
        customInstructions: cfg.customInstructions,
      },
    })
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
  const appearance = parseAppearance(obj.appearance ?? DEFAULT_APPEARANCE)
  if ('error' in appearance) return appearance
  const customInstructions = parseCustomInstructions(obj.customInstructions)
  if ('error' in customInstructions) return customInstructions
  return {
    agent: { defaultKind },
    notifications: { sessionEnd: { banner: s.banner, sound: s.sound } },
    shortcuts: normalizeShortcuts(shortcutObj),
    power: { inhibitWhenRunning },
    appearance,
    customInstructions,
  }
}

function parseAppearance(value: unknown): GlobalAppearanceConfig | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'appearance must be an object' }
  const obj = value as Record<string, unknown>
  const themeMode = obj.themeMode
  if (!isThemeMode(themeMode))
    return { error: 'appearance.themeMode must be system | light | dark' }
  const themeName = obj.themeName
  if (!isThemeName(themeName)) {
    return { error: 'appearance.themeName must be terminal | graphite | paper' }
  }
  const language = obj.language
  if (!isLanguage(language)) return { error: 'appearance.language must be zh-CN | en' }
  return { themeMode, themeName, language }
}

function parseCustomInstructions(value: unknown): GlobalCustomInstruction[] | { error: string } {
  if (value === undefined) return []
  if (!Array.isArray(value)) return { error: 'customInstructions must be an array' }
  const out: GlobalCustomInstruction[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') {
      return { error: `customInstructions.${index} must be an object` }
    }
    const obj = item as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id.trim() : ''
    const name = typeof obj.name === 'string' ? obj.name.trim().replace(/^\/+/, '') : ''
    if (!id) return { error: `customInstructions.${index}.id required` }
    if (!name || !/^[\w-]+$/.test(name)) {
      return {
        error: `customInstructions.${index}.name must use letters, numbers, underscores, or hyphens`,
      }
    }
    if (seen.has(id)) return { error: `duplicate custom instruction id: ${id}` }
    seen.add(id)
    const description = obj.description
    const systemPrompt = obj.systemPrompt
    const prefill = obj.prefill
    const createdAt = obj.createdAt
    if (typeof description !== 'string') {
      return { error: `customInstructions.${index}.description must be a string` }
    }
    if (typeof systemPrompt !== 'string') {
      return { error: `customInstructions.${index}.systemPrompt must be a string` }
    }
    if (typeof prefill !== 'string') {
      return { error: `customInstructions.${index}.prefill must be a string` }
    }
    if (typeof createdAt !== 'number' || createdAt <= 0) {
      return { error: `customInstructions.${index}.createdAt must be a positive number` }
    }
    out.push({ id, name, description, systemPrompt, prefill, createdAt })
  }
  return out
}
