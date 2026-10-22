import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { CommandDef } from './command-types.js'
import { type CustomInstruction, normalizeCustomInstructions } from './custom-instruction.js'

/**
 * `kind` is now an open string: `'inherit'`, a builtin id, or any
 * `customAgents[].id`. Resolution/validation happens downstream
 * (`resolveProjectAgentKind` + the adapter registry's fallback).
 */
export interface AgentConfig {
  kind: string
  /** Omitted means the local Agent chooses its own default. */
  model?: string
  /** Agent-specific effort/variant id; omitted delegates to the local Agent. */
  reasoningEffort?: string
}

export interface ProjectConfig {
  version: 1
  agent: AgentConfig
  specsDir: string
  /** User-configured commands runnable from the GUI. */
  commands: CommandDef[]
  /**
   * Project-scoped slash commands. Merged with the global list on send, with
   * this scope winning on a name clash (see `mergeCustomInstructions`).
   */
  customInstructions: CustomInstruction[]
}

const CURRENT_VERSION = 1 as const
export const DEFAULT_SPECS_DIR = '.yorz/specs'

export function defaultProjectConfig(): ProjectConfig {
  return {
    version: CURRENT_VERSION,
    agent: { kind: 'inherit' },
    specsDir: DEFAULT_SPECS_DIR,
    commands: [],
    customInstructions: [],
  }
}

export function configPath(cwd: string): string {
  return join(cwd, '.yorz', 'config.json')
}

export async function loadProjectConfig(cwd: string): Promise<ProjectConfig> {
  const fp = configPath(cwd)
  if (!existsSync(fp)) return defaultProjectConfig()
  let raw: string
  try {
    raw = await readFile(fp, 'utf8')
  } catch {
    return defaultProjectConfig()
  }
  if (!raw.trim()) return defaultProjectConfig()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultProjectConfig()
  }
  return normalizeConfig(parsed)
}

export async function saveProjectConfig(cwd: string, cfg: ProjectConfig): Promise<void> {
  const fp = configPath(cwd)
  await mkdir(dirname(fp), { recursive: true })
  const normalized = normalizeConfig(cfg)
  const body = `${JSON.stringify(normalized, null, 2)}\n`
  const tmp = `${fp}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, fp)
}

/**
 * Resolve specsDir to an absolute path under the project root.
 * Throws if the configured path escapes the project root.
 */
export function resolveSpecsDir(cwd: string, cfg: ProjectConfig): string {
  const root = resolve(cwd)
  const raw = (cfg.specsDir || DEFAULT_SPECS_DIR).trim() || DEFAULT_SPECS_DIR
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw)
  const rel = relative(root, abs)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`specsDir must stay within the project root: ${raw}`)
  }
  return abs
}

/** POSIX-style relative form used inside prompt templates / docs. */
export function relativeSpecsDir(cwd: string, cfg: ProjectConfig): string {
  const abs = resolveSpecsDir(cwd, cfg)
  return relative(resolve(cwd), abs).split(sep).join('/')
}

export async function ensureSpecsDirExists(absSpecsDir: string): Promise<void> {
  await mkdir(absSpecsDir, { recursive: true })
}

function normalizeConfig(value: unknown): ProjectConfig {
  if (!value || typeof value !== 'object') return defaultProjectConfig()
  const obj = value as Record<string, unknown>
  const agent = normalizeAgent(obj.agent)
  const specsDir = normalizeSpecsDir(obj.specsDir)
  const commands = normalizeCommands(obj.commands)
  // Whitelisted output: any field missing here is dropped on the next save, so
  // new config fields must be added to this object too.
  const customInstructions = normalizeCustomInstructions(obj.customInstructions)
  return { version: CURRENT_VERSION, agent, specsDir, commands, customInstructions }
}

/**
 * Whitelist-normalize the command list. Entries missing an id/name/cli are
 * dropped rather than repaired: a half-formed definition would spawn a
 * meaningless process, and silently keeping it hides the config error.
 */
function normalizeCommands(value: unknown): CommandDef[] {
  if (!Array.isArray(value)) return []
  const out: CommandDef[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id.trim() : ''
    const name = typeof obj.name === 'string' ? obj.name.trim() : ''
    const cli = typeof obj.cli === 'string' ? obj.cli.trim() : ''
    if (!id || !name || !cli || seen.has(id)) continue
    seen.add(id)
    const createdAt = typeof obj.createdAt === 'number' && obj.createdAt > 0 ? obj.createdAt : 0
    out.push({ id, name, cli, createdAt })
  }
  return out
}

function normalizeAgent(value: unknown): AgentConfig {
  // `kind` is an open string now (builtin id / customAgents id / 'inherit').
  // Legacy schema: `{ agent: '<id>' }` as a bare string.
  if (typeof value === 'string') {
    const k = value.trim()
    return k ? { kind: k } : { kind: 'claude' }
  }
  if (!value || typeof value !== 'object') return { kind: 'claude' }
  const obj = value as Record<string, unknown>
  const kind = typeof obj.kind === 'string' ? obj.kind.trim() : ''
  // Unknown ids are preserved verbatim: the adapter registry validates them at
  // resolve time (against customAgents) and falls back to claude on a miss, so
  // normalize must not pre-emptively flatten a valid external id to claude.
  const model = typeof obj.model === 'string' ? obj.model.trim() : ''
  const reasoningEffort = typeof obj.reasoningEffort === 'string' ? obj.reasoningEffort.trim() : ''
  return {
    kind: kind || 'claude',
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}

function normalizeSpecsDir(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SPECS_DIR
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_SPECS_DIR
  return trimmed
}
