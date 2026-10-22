import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getLogger } from '../logger.js'
import {
  loadGlobalConfig,
  resolveGlobalConfigPath,
  type ExternalAgentDef,
} from '../global-config.js'
import { ClaudeAdapter } from './claude-adapter.js'
import { CodexAdapter } from './codex-adapter.js'
import { OpenCodeAdapter } from './opencode-adapter.js'
import { PiAdapter } from './pi-adapter.js'
import {
  BUILTIN_AGENT_IDS,
  isBuiltinAgentId,
  type AgentAdapterContext,
  type AgentDescriptor,
  type AgentId,
  type AgentModelCatalog,
  type AgentSdkAdapter,
  type BuiltinAgentId,
  type CreateAgentAdapter,
} from './types.js'

const log = () => getLogger().child('agent-sdk')

/** In-process factories for the builtin agents — the only privileged ids. */
const BUILTIN_FACTORIES: Record<BuiltinAgentId, (cwd: string) => AgentSdkAdapter> = {
  claude: (cwd) => new ClaudeAdapter(cwd),
  codex: (cwd) => new CodexAdapter(cwd),
  opencode: (cwd) => new OpenCodeAdapter(cwd),
  pi: (cwd) => new PiAdapter(cwd),
}

/** Methods every adapter MUST implement (only `getUsageStatus` is optional). */
const REQUIRED_METHODS = [
  'createSession',
  'resumeSession',
  'listSessions',
  'getMessages',
  'capabilities',
  'dispose',
] as const

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Open adapter registry. Builtin ids resolve to in-process factories; any other
 * id is looked up in the **global** config's `customAgents` (external agents are
 * host-global, not project-scoped) and loaded by dynamic `import()`. Adapters
 * are still constructed with the project `cwd` (sessions run in the project
 * dir), but "which external agents exist" comes from the global config.
 * Load/validation failure logs and safely falls back to the claude adapter — a
 * misconfigured external agent must never break the whole project.
 */
export class AdapterRegistry {
  private readonly byId = new Map<AgentId, AgentSdkAdapter>()
  private defsPromise: Promise<Map<string, ExternalAgentDef>> | null = null

  constructor(
    private readonly cwd: string,
    private readonly globalConfigPath?: string,
  ) {}

  private externalDefs(): Promise<Map<string, ExternalAgentDef>> {
    // Memoized for the registry's lifetime: the global config has no watcher in
    // this path, and a project instance is rebuilt when config changes.
    if (!this.defsPromise) {
      this.defsPromise = loadGlobalConfig(this.globalConfigPath)
        .then((cfg) => new Map(cfg.customAgents.map((d) => [d.id, d])))
        .catch(() => new Map<string, ExternalAgentDef>())
    }
    return this.defsPromise
  }

  /** Resolve (and cache) the adapter for an id, falling back to claude. */
  async get(id: AgentId): Promise<AgentSdkAdapter> {
    const cached = this.byId.get(id)
    if (cached) return cached
    let adapter: AgentSdkAdapter
    if (isBuiltinAgentId(id)) {
      adapter = BUILTIN_FACTORIES[id](this.cwd)
    } else {
      const def = (await this.externalDefs()).get(id)
      if (!def) {
        log().warn('unknown agent id; falling back to claude', { id })
        adapter = BUILTIN_FACTORIES.claude(this.cwd)
      } else {
        try {
          adapter = await this.buildExternal(def)
        } catch (err) {
          log().error('external agent failed to load; falling back to claude', {
            id: def.id,
            module: def.module,
            message: errMessage(err),
          })
          adapter = BUILTIN_FACTORIES.claude(this.cwd)
        }
      }
    }
    this.byId.set(id, adapter)
    return adapter
  }

  /** Builtin + configured-external descriptors for GUI/route enumeration. */
  async listDescriptors(): Promise<AgentDescriptor[]> {
    const out: AgentDescriptor[] = []
    for (const id of BUILTIN_AGENT_IDS) {
      out.push((await this.get(id)).descriptor)
    }
    for (const def of (await this.externalDefs()).values()) {
      const adapter = await this.get(def.id)
      // A successful load exposes the agent's own descriptor; a fallback (id
      // mismatch) means it failed to load — synthesize a minimal descriptor so
      // the id still appears, with all capabilities declared off.
      out.push(
        adapter.descriptor.id === def.id
          ? adapter.descriptor
          : {
              id: def.id,
              displayName: def.name || def.id,
              source: 'external',
              capabilities: { listSessions: false, getMessages: false, usageStatus: false },
            },
      )
    }
    return out
  }

  /** Query one adapter lazily; unsupported/failed catalogs degrade to empty. */
  async listModels(id: AgentId): Promise<AgentModelCatalog> {
    const adapter = await this.get(id)
    if (!adapter.listModels) return { models: [], defaultReasoningEfforts: [] }
    try {
      return await adapter.listModels()
    } catch (err) {
      log().warn('agent model catalog failed', { id, message: errMessage(err) })
      return { models: [], defaultReasoningEfforts: [] }
    }
  }

  private async buildExternal(def: ExternalAgentDef): Promise<AgentSdkAdapter> {
    const specifier = this.resolveModuleSpecifier(def.module)
    const mod = (await import(specifier)) as Record<string, unknown>
    const factory = (mod.createAgentAdapter ?? mod.default) as CreateAgentAdapter | undefined
    if (typeof factory !== 'function') {
      throw new Error(`module '${def.module}' does not export a createAgentAdapter factory`)
    }
    const ctx: AgentAdapterContext = {
      cwd: this.cwd,
      descriptor: {
        id: def.id,
        displayName: def.name || def.id,
        source: 'external',
        // Seed only — the adapter's own `descriptor` is authoritative.
        capabilities: { listSessions: false, getMessages: false, usageStatus: false },
      },
      logger: log(),
    }
    const adapter = factory(ctx)
    assertContract(def.id, adapter)
    return adapter
  }

  /**
   * Turn a `module` string into an `import()` specifier. External agents are
   * host-global, so there is no project-root containment guard:
   *  - absolute path → loaded as-is;
   *  - relative path → anchored at the global config dir (the dir holding the
   *    config file that declared it — not the project root);
   *  - bare name → npm package, resolved from the global npm root first (so
   *    `npm install -g <pkg>` works regardless of how yorz itself is installed),
   *    falling back to normal resolution (bundled / local-dev siblings).
   */
  private resolveModuleSpecifier(module: string): string {
    const looksLikePath = module.startsWith('.') || module.startsWith('/') || isAbsolute(module)
    if (looksLikePath) {
      const configDir = dirname(this.globalConfigPath ?? resolveGlobalConfigPath())
      const abs = isAbsolute(module) ? resolve(module) : resolve(configDir, module)
      return pathToFileURL(abs).href
    }
    return resolveFromGlobalNodeModules(module) ?? module
  }

  async dispose(): Promise<void> {
    for (const a of this.byId.values()) {
      await a.dispose().catch(() => {})
    }
    this.byId.clear()
  }
}

/** Standard npm global `node_modules` directory for the running Node install. */
function globalNodeModulesDir(): string {
  const execDir = dirname(process.execPath)
  // win32: `<nodeDir>/node_modules`; posix: `<prefix>/lib/node_modules`.
  return process.platform === 'win32'
    ? join(execDir, 'node_modules')
    : join(dirname(execDir), 'lib', 'node_modules')
}

/**
 * Resolve a bare npm specifier against the global `node_modules` and return a
 * `file://` URL, or `null` when it can't be resolved there (caller falls back to
 * normal resolution). Anchoring a `require` inside the global dir lets Node's
 * upward `node_modules` walk find globally-installed packages.
 */
function resolveFromGlobalNodeModules(module: string): string | null {
  try {
    const req = createRequire(join(globalNodeModulesDir(), 'noop.js'))
    return pathToFileURL(req.resolve(module)).href
  } catch {
    return null
  }
}

function assertContract(id: string, adapter: unknown): asserts adapter is AgentSdkAdapter {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error(`agent '${id}' factory did not return an object`)
  }
  const a = adapter as Record<string, unknown>
  for (const method of REQUIRED_METHODS) {
    if (typeof a[method] !== 'function') {
      throw new Error(`agent '${id}' is missing required method '${method}()'`)
    }
  }
  const d = a.descriptor
  if (!d || typeof d !== 'object') {
    throw new Error(`agent '${id}' is missing required 'descriptor'`)
  }
}
