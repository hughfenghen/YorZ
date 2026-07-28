import { Hono } from 'hono'
import {
  defaultProjectConfig,
  ensureSpecsDirExists,
  loadProjectConfig,
  resolveSpecsDir,
  saveProjectConfig,
  type AgentConfig,
  type ProjectConfig,
} from '../project-config.js'
import type { ProjectRegistry } from '../project-registry.js'

interface PutBody {
  agent: AgentConfig
  specsDir: string
}

export function createProjectConfigRoutes(registry: ProjectRegistry): Hono {
  const app = new Hono()

  app.get('/projects/:projectId/config', async (c) => {
    const id = c.req.param('projectId')
    const entry = await registry.findEntry(id)
    if (!entry) return c.json({ error: 'project not found' }, 404)
    const cfg = await loadProjectConfig(entry.path)
    return c.json(cfg)
  })

  app.put('/projects/:projectId/config', async (c) => {
    const id = c.req.param('projectId')
    const entry = await registry.findEntry(id)
    if (!entry) return c.json({ error: 'project not found' }, 404)
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const parsed = parseBody(raw)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    const cfg: ProjectConfig = {
      version: 1,
      agent: parsed.agent,
      specsDir: parsed.specsDir,
    }
    // Validate specsDir stays within the project root (throws otherwise).
    let absSpecsDir: string
    try {
      absSpecsDir = resolveSpecsDir(entry.path, cfg)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400)
    }
    try {
      await ensureSpecsDirExists(absSpecsDir)
    } catch (err) {
      return c.json({ error: `failed to create specsDir: ${(err as Error).message}` }, 400)
    }
    try {
      await saveProjectConfig(entry.path, cfg)
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
    // Drop cached SpecStore / SpecWatcher so the next request re-materializes
    // them against the new specsDir.
    await registry.reload(id)
    return c.json({ ok: true, config: cfg })
  })

  return app
}

function parseBody(value: unknown): PutBody | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'body must be an object' }
  const obj = value as Record<string, unknown>
  const agent = parseAgent(obj.agent)
  if ('error' in agent) return agent
  const specsDir = parseSpecsDir(obj.specsDir)
  if ('error' in specsDir) return specsDir
  return { agent: agent.value, specsDir: specsDir.value }
}

function parseAgent(value: unknown): { value: AgentConfig } | { error: string } {
  if (!value || typeof value !== 'object') {
    return { error: 'agent must be an object with `kind`' }
  }
  const obj = value as Record<string, unknown>
  const kind = obj.kind
  if (kind === 'inherit') return { value: { kind: 'inherit' } }
  if (kind === 'claude') return { value: { kind: 'claude' } }
  if (kind === 'opencode') return { value: { kind: 'opencode' } }
  if (kind === 'codex') return { value: { kind: 'codex' } }
  if (kind === 'custom') {
    const cmd = obj.cmd
    if (typeof cmd !== 'string' || !cmd.trim()) {
      return { error: 'agent.cmd required when kind=custom' }
    }
    if (cmd.length > 500) return { error: 'agent.cmd too long (max 500)' }
    const argsRaw = obj.args
    let args: string[] = []
    if (argsRaw !== undefined) {
      if (!Array.isArray(argsRaw)) return { error: 'agent.args must be an array of strings' }
      args = []
      for (const a of argsRaw) {
        if (typeof a !== 'string') return { error: 'agent.args entries must be strings' }
        if (a.length > 500) return { error: 'agent.args entry too long (max 500)' }
        args.push(a)
      }
      if (args.length > 64) return { error: 'agent.args too many entries (max 64)' }
    }
    return { value: { kind: 'custom', cmd: cmd.trim(), args } }
  }
  return { error: 'agent.kind must be inherit | claude | opencode | codex | custom' }
}

function parseSpecsDir(value: unknown): { value: string } | { error: string } {
  const fallback = defaultProjectConfig().specsDir
  if (value === undefined || value === null || value === '') return { value: fallback }
  if (typeof value !== 'string') return { error: 'specsDir must be a string' }
  const trimmed = value.trim()
  if (!trimmed) return { value: fallback }
  if (trimmed.length > 500) return { error: 'specsDir too long (max 500)' }
  if (trimmed.split(/[\\/]/).some((seg) => seg === '..')) {
    return { error: 'specsDir must not contain ".." segments' }
  }
  return { value: trimmed }
}
