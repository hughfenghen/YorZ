import { createSignal } from 'solid-js'
import { api, type CustomInstruction, type GlobalConfig } from './api.js'
import { applyAppearance } from './theme.js'
import { i18next } from '../i18n/config.js'

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  agent: {
    defaultKind: 'claude',
  },
  notifications: {
    sessionEnd: {
      banner: false,
      sound: false,
    },
  },
  shortcuts: {},
  power: {
    inhibitWhenRunning: 'system-default',
  },
  appearance: {
    themeMode: 'system',
    themeName: 'terminal',
    language: 'zh-CN',
  },
  customInstructions: [],
}

const [globalConfig, setGlobalConfig] = createSignal<GlobalConfig>(DEFAULT_GLOBAL_CONFIG)

export { globalConfig }

export async function refreshGlobalConfig(): Promise<GlobalConfig> {
  try {
    const cfg = await api.getGlobalConfig()
    setGlobalConfig(cfg)
    applyGlobalAppearance(cfg)
    migrateLegacyAppearance(cfg)
    return cfg
  } catch {
    setGlobalConfig(DEFAULT_GLOBAL_CONFIG)
    applyGlobalAppearance(DEFAULT_GLOBAL_CONFIG)
    return DEFAULT_GLOBAL_CONFIG
  }
}

export async function saveGlobalConfig(next: GlobalConfig): Promise<GlobalConfig> {
  const res = await api.updateGlobalConfig(next)
  setGlobalConfig(res.config)
  applyGlobalAppearance(res.config)
  clearLegacyAppearanceStorage()
  return res.config
}

export async function updateGlobalConfig(
  updater: (current: GlobalConfig) => GlobalConfig,
): Promise<GlobalConfig> {
  return saveGlobalConfig(updater(globalConfig()))
}

export async function saveCustomInstructions(
  customInstructions: CustomInstruction[],
): Promise<GlobalConfig> {
  return updateGlobalConfig((current) => ({ ...current, customInstructions }))
}

export function applyGlobalAppearance(cfg: GlobalConfig): void {
  applyAppearance(cfg.appearance.themeMode, cfg.appearance.themeName)
  if (i18next.language !== cfg.appearance.language) {
    void i18next.changeLanguage(cfg.appearance.language)
  }
}

function migrateLegacyAppearance(cfg: GlobalConfig): void {
  if (typeof window === 'undefined') return
  try {
    const storage = window.localStorage
    const themeMode = storage.getItem('yorz.theme')
    const themeName = storage.getItem('yorz.themeName')
    const language = storage.getItem('yorz.lang')
    const legacyInstructions = readLegacyCustomInstructions(
      storage.getItem('yorz.chat.customSlashCommands'),
    )
    const appearance = cfg.appearance
    const next = {
      themeMode: isThemeMode(themeMode) ? themeMode : appearance.themeMode,
      themeName: isThemeName(themeName) ? themeName : appearance.themeName,
      language: isLanguage(language) ? language : appearance.language,
    }
    const customInstructions =
      cfg.customInstructions.length > 0 || legacyInstructions.length === 0
        ? cfg.customInstructions
        : legacyInstructions
    if (
      next.themeMode === appearance.themeMode &&
      next.themeName === appearance.themeName &&
      next.language === appearance.language &&
      customInstructions === cfg.customInstructions
    ) {
      clearLegacyAppearanceStorage()
      return
    }
    void updateGlobalConfig((current) => ({ ...current, appearance: next, customInstructions }))
  } catch {
    // Storage may be unavailable in private contexts.
  }
}

function clearLegacyAppearanceStorage(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem('yorz.theme')
    window.localStorage.removeItem('yorz.themeName')
    window.localStorage.removeItem('yorz.lang')
    window.localStorage.removeItem('yorz.chat.customSlashCommands')
  } catch {
    // Storage may be unavailable in private contexts.
  }
}

function isThemeMode(value: unknown): value is GlobalConfig['appearance']['themeMode'] {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isThemeName(value: unknown): value is GlobalConfig['appearance']['themeName'] {
  return value === 'terminal' || value === 'graphite' || value === 'paper'
}

function isLanguage(value: unknown): value is GlobalConfig['appearance']['language'] {
  return value === 'zh-CN' || value === 'en'
}

function readLegacyCustomInstructions(raw: string | null): GlobalConfig['customInstructions'] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCustomInstruction)
  } catch {
    return []
  }
}

function isCustomInstruction(value: unknown): value is GlobalConfig['customInstructions'][number] {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.systemPrompt === 'string' &&
    typeof obj.prefill === 'string' &&
    typeof obj.createdAt === 'number'
  )
}
