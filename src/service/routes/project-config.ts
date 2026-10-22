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
import { parseCustomInstructions } from '../custom-instruction.js'
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
    // Commands and custom instructions are managed by their own routes, not by
    // this dialog. Carry the stored lists over verbatim so saving agent/specsDir
    // never wipes them.
    const current = await loadProjectConfig(entry.path)
    const cfg: ProjectConfig = {
      version: 1,
      agent: parsed.agent,
      specsDir: parsed.specsDir,
      commands: current.commands,
      customInstructions: current.customInstructions,
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

  app.get('/projects/:projectId/custom-instructions', async (c) => {
    const id = c.req.param('projectId')
    const entry = await registry.findEntry(id)
    if (!entry) return c.json({ error: 'project not found' }, 404)
    const cfg = await loadProjectConfig(entry.path)
    return c.json({ customInstructions: cfg.customInstructions })
  })

  // Whole-list replace, mirroring the global config route: the picker always
  // holds the full list, and a per-entry API would need conflict handling the
  // GUI has no way to surface.
  app.put('/projects/:projectId/custom-instructions', async (c) => {
    const id = c.req.param('projectId')
    const entry = await registry.findEntry(id)
    if (!entry) return c.json({ error: 'project not found' }, 404)
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    if (!raw || typeof raw !== 'object') return c.json({ error: 'body must be an object' }, 400)
    const parsed = parseCustomInstructions((raw as Record<string, unknown>).customInstructions)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    const current = await loadProjectConfig(entry.path)
    try {
      await saveProjectConfig(entry.path, { ...current, customInstructions: parsed })
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500)
    }
    return c.json({ ok: true, customInstructions: parsed })
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
  const kind = typeof obj.kind === 'string' ? obj.kind.trim() : ''
  // `kind` is open now: 'inherit', a builtin id, or any customAgents[].id. The
  // registry validates/falls back at resolve time, so accept any non-empty id.
  if (!kind) return { error: 'agent.kind must be a non-empty string' }
  const model = typeof obj.model === 'string' ? obj.model.trim() : ''
  const reasoningEffort = typeof obj.reasoningEffort === 'string' ? obj.reasoningEffort.trim() : ''
  return {
    value: {
      kind,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    },
  }
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
