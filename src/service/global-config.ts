import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { type CustomInstruction, normalizeCustomInstructions } from './custom-instruction.js'

export interface WorktreeMeta {
  mainProjectId: string
  mainPath: string
  branch: string
  specId: string
  createdAt: string
  cleanSlug?: string
}

export interface GlobalProjectEntry {
  id: string
  path: string
  addedAt: string
  lastActivityAt: string | null
  worktree?: WorktreeMeta
}

export interface GlobalConfig {
  version: 1
  projects: GlobalProjectEntry[]
  agent: GlobalAgentConfig
  notifications: GlobalNotificationsConfig
  shortcuts: GlobalShortcutsConfig
  power: GlobalPowerConfig
  appearance: GlobalAppearanceConfig
  customInstructions: GlobalCustomInstruction[]
}

export type GlobalConfigInput = Omit<
  GlobalConfig,
  'power' | 'appearance' | 'customInstructions'
> & {
  power?: GlobalPowerConfig
  appearance?: GlobalAppearanceConfig
  customInstructions?: GlobalCustomInstruction[]
}

export interface GlobalAgentConfig {
  defaultKind: GlobalAgentKind
}

export type GlobalAgentKind = 'claude' | 'opencode' | 'codex'

export interface GlobalNotificationsConfig {
  sessionEnd: SessionEndNotificationsConfig
}

export interface GlobalPowerConfig {
  inhibitWhenRunning: PowerInhibitMode
}

export type PowerInhibitMode = 'system-default' | 'prevent-display-sleep' | 'keep-system-awake'
export type GlobalThemeMode = 'system' | 'light' | 'dark'
export type GlobalThemeName = 'terminal' | 'graphite' | 'paper'
export type GlobalLanguage = 'zh-CN' | 'en'

export interface GlobalAppearanceConfig {
  themeMode: GlobalThemeMode
  themeName: GlobalThemeName
  language: GlobalLanguage
}

/**
 * Alias kept for existing call sites; the shape is shared with the project
 * scope and owned by `custom-instruction.ts`.
 */
export type GlobalCustomInstruction = CustomInstruction

export interface SessionEndNotificationsConfig {
  banner: boolean
  sound: boolean
}

export type GlobalShortcutActionId = 'newSpec' | 'toggleSpecDetailFullscreen' | 'projectSettings'
export type GlobalShortcutsConfig = Partial<Record<GlobalShortcutActionId, string | null>>

const CURRENT_VERSION = 1 as const
export const DEFAULT_GLOBAL_AGENT: GlobalAgentConfig = { defaultKind: 'claude' }
export const DEFAULT_NOTIFICATIONS: GlobalNotificationsConfig = {
  sessionEnd: { banner: false, sound: false },
}
export const DEFAULT_POWER: GlobalPowerConfig = {
  inhibitWhenRunning: 'system-default',
}
export const DEFAULT_APPEARANCE: GlobalAppearanceConfig = {
  themeMode: 'system',
  themeName: 'terminal',
  language: 'zh-CN',
}
export const SHORTCUT_ACTION_IDS: GlobalShortcutActionId[] = [
  'newSpec',
  'toggleSpecDetailFullscreen',
  'projectSettings',
]

export function resolveGlobalConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.YORZ_HOME && env.YORZ_HOME.trim()) return env.YORZ_HOME.trim()
  const xdg = env.XDG_CONFIG_HOME?.trim()
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config')
  return join(base, 'yorz')
}

export function resolveGlobalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveGlobalConfigDir(env), 'config.json')
}

export function resolveLegacyGlobalProjectsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveGlobalConfigDir(env), 'projects.json')
}

/**
 * Directory holding the bundled skills, shared by every yorz project.
 * Follows the same `YORZ_HOME` > `XDG_CONFIG_HOME` > `~/.config` resolution as
 * {@link resolveGlobalConfigDir}, so a single copy serves all projects instead
 * of polluting each Agent's own skills directory.
 */
export function resolveGlobalSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveGlobalConfigDir(env), 'skills')
}

/** Absolute path to a bundled skill's `SKILL.md` entry inside the shared dir. */
export function resolveSkillEntry(skillName: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveGlobalSkillsDir(env), skillName, 'SKILL.md')
}

export async function loadGlobalConfig(filePath?: string): Promise<GlobalConfig> {
  const fp = filePath ?? resolveGlobalConfigPath()
  if (!existsSync(fp)) {
    const legacy = filePath
      ? basename(fp) === 'config.json'
        ? join(dirname(fp), 'projects.json')
        : ''
      : resolveLegacyGlobalProjectsPath()
    if (legacy && existsSync(legacy)) return loadGlobalConfigFromPath(legacy)
    return defaultGlobalConfig()
  }
  return loadGlobalConfigFromPath(fp)
}

async function loadGlobalConfigFromPath(fp: string): Promise<GlobalConfig> {
  let raw: string
  try {
    raw = await readFile(fp, 'utf8')
  } catch {
    return defaultGlobalConfig()
  }
  if (!raw.trim()) return defaultGlobalConfig()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultGlobalConfig()
  }
  return normalizeConfig(parsed)
}

export async function saveGlobalConfig(
  config: GlobalConfigInput,
  filePath?: string,
): Promise<void> {
  const fp = filePath ?? resolveGlobalConfigPath()
  await mkdir(dirname(fp), { recursive: true })
  const normalized = normalizeConfig(config)
  const body = `${JSON.stringify(normalized, null, 2)}\n`
  const tmp = `${fp}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, fp)
}

function normalizeConfig(value: unknown): GlobalConfig {
  if (!value || typeof value !== 'object') return defaultGlobalConfig()
  const obj = value as Record<string, unknown>
  const projectsRaw = Array.isArray(obj.projects) ? obj.projects : []
  const projects: GlobalProjectEntry[] = []
  for (const item of projectsRaw) {
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    const id = typeof it.id === 'string' ? it.id : ''
    const path = typeof it.path === 'string' ? it.path : ''
    if (!id || !path) continue
    const addedAt = typeof it.addedAt === 'string' ? it.addedAt : ''
    const lastActivityAt = typeof it.lastActivityAt === 'string' ? it.lastActivityAt : null
    const worktree = normalizeWorktree(it.worktree)
    const entry: GlobalProjectEntry = { id, path, addedAt, lastActivityAt }
    if (worktree) entry.worktree = worktree
    projects.push(entry)
  }
  return {
    version: CURRENT_VERSION,
    projects,
    agent: normalizeAgent(obj.agent),
    notifications: normalizeNotifications(obj.notifications),
    shortcuts: normalizeShortcuts(obj.shortcuts),
    power: normalizePower(obj.power),
    appearance: normalizeAppearance(obj.appearance),
    customInstructions: normalizeCustomInstructions(obj.customInstructions),
  }
}

export function defaultGlobalConfig(): GlobalConfig {
  return {
    version: CURRENT_VERSION,
    projects: [],
    agent: { defaultKind: DEFAULT_GLOBAL_AGENT.defaultKind },
    notifications: {
      sessionEnd: {
        banner: DEFAULT_NOTIFICATIONS.sessionEnd.banner,
        sound: DEFAULT_NOTIFICATIONS.sessionEnd.sound,
      },
    },
    shortcuts: {},
    power: {
      inhibitWhenRunning: DEFAULT_POWER.inhibitWhenRunning,
    },
    appearance: { ...DEFAULT_APPEARANCE },
    customInstructions: [],
  }
}

function normalizeAgent(value: unknown): GlobalAgentConfig {
  if (!value || typeof value !== 'object') return { defaultKind: DEFAULT_GLOBAL_AGENT.defaultKind }
  const obj = value as Record<string, unknown>
  const defaultKind = obj.defaultKind
  if (defaultKind === 'opencode' || defaultKind === 'codex') return { defaultKind }
  return { defaultKind: 'claude' }
}

function normalizeNotifications(value: unknown): GlobalNotificationsConfig {
  if (!value || typeof value !== 'object') return defaultGlobalConfig().notifications
  const obj = value as Record<string, unknown>
  const sessionEndRaw = obj.sessionEnd
  if (!sessionEndRaw || typeof sessionEndRaw !== 'object')
    return defaultGlobalConfig().notifications
  const sessionEndObj = sessionEndRaw as Record<string, unknown>
  return {
    sessionEnd: {
      banner:
        typeof sessionEndObj.banner === 'boolean'
          ? sessionEndObj.banner
          : DEFAULT_NOTIFICATIONS.sessionEnd.banner,
      sound:
        typeof sessionEndObj.sound === 'boolean'
          ? sessionEndObj.sound
          : DEFAULT_NOTIFICATIONS.sessionEnd.sound,
    },
  }
}

export function normalizeShortcuts(value: unknown): GlobalShortcutsConfig {
  if (!value || typeof value !== 'object') return {}
  const obj = value as Record<string, unknown>
  const shortcuts: GlobalShortcutsConfig = {}
  for (const action of SHORTCUT_ACTION_IDS) {
    const raw = obj[action]
    if (raw === null) {
      shortcuts[action] = null
      continue
    }
    if (typeof raw !== 'string') continue
    const normalized = normalizeShortcutBinding(raw)
    if (normalized) shortcuts[action] = normalized
  }
  return shortcuts
}

function normalizePower(value: unknown): GlobalPowerConfig {
  if (!value || typeof value !== 'object') {
    return { inhibitWhenRunning: DEFAULT_POWER.inhibitWhenRunning }
  }
  const obj = value as Record<string, unknown>
  const mode = obj.inhibitWhenRunning
  if (
    mode === 'prevent-display-sleep' ||
    mode === 'keep-system-awake' ||
    mode === 'system-default'
  ) {
    return { inhibitWhenRunning: mode }
  }
  return { inhibitWhenRunning: DEFAULT_POWER.inhibitWhenRunning }
}

function normalizeAppearance(value: unknown): GlobalAppearanceConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_APPEARANCE }
  const obj = value as Record<string, unknown>
  const themeMode = obj.themeMode
  const themeName = obj.themeName
  const language = obj.language
  return {
    themeMode: isThemeMode(themeMode) ? themeMode : DEFAULT_APPEARANCE.themeMode,
    themeName: isThemeName(themeName) ? themeName : DEFAULT_APPEARANCE.themeName,
    language: isLanguage(language) ? language : DEFAULT_APPEARANCE.language,
  }
}

export function isThemeMode(value: unknown): value is GlobalThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isThemeName(value: unknown): value is GlobalThemeName {
  return value === 'terminal' || value === 'graphite' || value === 'paper'
}

export function isLanguage(value: unknown): value is GlobalLanguage {
  return value === 'zh-CN' || value === 'en'
}

export function normalizeShortcutBinding(value: string): string | null {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  let key = ''
  let ctrl = false
  let shift = false
  let alt = false
  let meta = false
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') ctrl = true
    else if (lower === 'shift') shift = true
    else if (lower === 'alt' || lower === 'option') alt = true
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') meta = true
    else key = normalizeShortcutKey(part)
  }
  if (!key) return null
  const out: string[] = []
  if (ctrl) out.push('Ctrl')
  if (shift) out.push('Shift')
  if (alt) out.push('Alt')
  if (meta) out.push('Meta')
  out.push(key)
  return out.join('+')
}

function normalizeShortcutKey(key: string): string {
  if (key.length === 1) return key.toUpperCase()
  if (key === ' ') return 'Space'
  if (key.startsWith('Arrow')) return key
  return key.slice(0, 1).toUpperCase() + key.slice(1)
}

function normalizeWorktree(value: unknown): WorktreeMeta | undefined {
  if (!value || typeof value !== 'object') return undefined
  const it = value as Record<string, unknown>
  const mainProjectId = typeof it.mainProjectId === 'string' ? it.mainProjectId : ''
  const mainPath = typeof it.mainPath === 'string' ? it.mainPath : ''
  const branch = typeof it.branch === 'string' ? it.branch : ''
  const specId = typeof it.specId === 'string' ? it.specId : ''
  const createdAt = typeof it.createdAt === 'string' ? it.createdAt : ''
  if (!mainProjectId || !mainPath || !branch) return undefined
  const cleanSlug = typeof it.cleanSlug === 'string' ? it.cleanSlug : undefined
  const meta: WorktreeMeta = { mainProjectId, mainPath, branch, specId, createdAt }
  if (cleanSlug) meta.cleanSlug = cleanSlug
  return meta
}

export function generateProjectId(absPath: string): string {
  const base = basename(absPath)
  const slug = slugify(base) || 'proj'
  const hash = createHash('sha256').update(absPath).digest('hex').slice(0, 6)
  return `${slug}-${hash}`
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

export interface AddProjectResult {
  entry: GlobalProjectEntry
  created: boolean
}

export async function addProject(
  absPath: string,
  filePath?: string,
  now: () => Date = () => new Date(),
): Promise<AddProjectResult> {
  const config = await loadGlobalConfig(filePath)
  const existing = config.projects.find((p) => p.path === absPath)
  if (existing) return { entry: existing, created: false }
  const entry: GlobalProjectEntry = {
    id: generateProjectId(absPath),
    path: absPath,
    addedAt: now().toISOString(),
    lastActivityAt: null,
  }
  config.projects.push(entry)
  await saveGlobalConfig(config, filePath)
  return { entry, created: true }
}

export async function setProjectWorktree(
  id: string,
  worktree: WorktreeMeta | null,
  filePath?: string,
): Promise<boolean> {
  const config = await loadGlobalConfig(filePath)
  const target = config.projects.find((p) => p.id === id)
  if (!target) return false
  if (worktree) target.worktree = worktree
  else delete target.worktree
  await saveGlobalConfig(config, filePath)
  return true
}

export async function removeProject(id: string, filePath?: string): Promise<boolean> {
  const config = await loadGlobalConfig(filePath)
  const before = config.projects.length
  config.projects = config.projects.filter((p) => p.id !== id)
  if (config.projects.length === before) return false
  await saveGlobalConfig(config, filePath)
  return true
}

export async function touchProjectActivity(
  id: string,
  when: string,
  filePath?: string,
): Promise<boolean> {
  const config = await loadGlobalConfig(filePath)
  const target = config.projects.find((p) => p.id === id)
  if (!target) return false
  target.lastActivityAt = when
  await saveGlobalConfig(config, filePath)
  return true
}

export async function prepareProjectDir(input: string, cwd?: string): Promise<string> {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('path required')
  }
  const trimmed = input.trim()
  const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd ?? process.cwd(), trimmed)
  if (!existsSync(abs)) {
    throw new Error(`path does not exist: ${abs}`)
  }
  const stats = await stat(abs)
  if (!stats.isDirectory()) {
    throw new Error(`path is not a directory: ${abs}`)
  }
  await mkdir(join(abs, '.yorz', 'specs'), { recursive: true })
  return abs
}
