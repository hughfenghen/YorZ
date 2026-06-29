import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

export interface WorktreeMeta {
  mainProjectId: string
  mainPath: string
  branch: string
  specId: string
  createdAt: string
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
}

const CURRENT_VERSION = 1 as const

export function resolveGlobalConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.YORZ_HOME && env.YORZ_HOME.trim()) return env.YORZ_HOME.trim()
  const xdg = env.XDG_CONFIG_HOME?.trim()
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config')
  return join(base, 'yorz')
}

export function resolveGlobalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveGlobalConfigDir(env), 'projects.json')
}

export async function loadGlobalConfig(filePath?: string): Promise<GlobalConfig> {
  const fp = filePath ?? resolveGlobalConfigPath()
  if (!existsSync(fp)) return { version: CURRENT_VERSION, projects: [] }
  let raw: string
  try {
    raw = await readFile(fp, 'utf8')
  } catch {
    return { version: CURRENT_VERSION, projects: [] }
  }
  if (!raw.trim()) return { version: CURRENT_VERSION, projects: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { version: CURRENT_VERSION, projects: [] }
  }
  return normalizeConfig(parsed)
}

export async function saveGlobalConfig(config: GlobalConfig, filePath?: string): Promise<void> {
  const fp = filePath ?? resolveGlobalConfigPath()
  await mkdir(dirname(fp), { recursive: true })
  const normalized = normalizeConfig(config)
  const body = `${JSON.stringify(normalized, null, 2)}\n`
  const tmp = `${fp}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, fp)
}

function normalizeConfig(value: unknown): GlobalConfig {
  if (!value || typeof value !== 'object') return { version: CURRENT_VERSION, projects: [] }
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
  return { version: CURRENT_VERSION, projects }
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
  return { mainProjectId, mainPath, branch, specId, createdAt }
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
