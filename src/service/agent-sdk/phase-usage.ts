import { normalizeUsage } from '../telemetry/index.js'
import type { PhaseUsageSnapshot, UsageSnapshot } from '../telemetry/index.js'
import type { AgentKind } from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Tool calls that count as "the Agent wrote the spec back", per agent.
 *
 * Tool names are agent-specific: Claude ships PascalCase builtins (`Write`),
 * Pi ships lowercase ones (`write`). Keying by kind keeps the detection honest
 * instead of union-matching every spelling and silently accepting the wrong one.
 */
const SPEC_WRITE_TOOLS: Record<AgentKind, ReadonlySet<string>> = {
  claude: new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']),
  codex: new Set<string>(),
  opencode: new Set(['write', 'edit', 'patch']),
  'opencode-v2': new Set(['write', 'edit', 'patch']),
  pi: new Set(['write', 'edit']),
}

/** Argument keys each agent uses to name the file a write/edit tool targets. */
const PATH_KEYS = ['file_path', 'filePath', 'path'] as const

/**
 * Does this tool call write a spec document?
 *
 * Matched on the path suffix rather than the configured `specsDir`: the adapter
 * has no access to project config, and threading it down here would couple the
 * SDK boundary to spec layout for the sake of one observation point. The known
 * gap is legacy `docs/specs/<name>.md` paths, which this misses.
 */
export function isSpecWrite(kind: AgentKind, name: unknown, input: unknown): boolean {
  if (typeof name !== 'string' || !SPEC_WRITE_TOOLS[kind].has(name)) return false
  if (!isRecord(input)) return false
  for (const key of PATH_KEYS) {
    const path = input[key]
    if (typeof path === 'string' && path.endsWith('spec.md')) return true
  }
  return false
}

/**
 * Sums per-request usage so one turn can be split at a phase boundary.
 *
 * Agents report usage once, at the end of the turn, which cannot answer "how
 * much of this dispatch went into planning?". Every assistant message carries
 * its own request's usage, so summing them as they stream in makes any point
 * mid-turn measurable.
 */
export class PhaseAccumulator {
  private readonly usage: UsageSnapshot = {}
  private requests = 0
  constructor(
    private readonly kind: AgentKind,
    private readonly startedAt: number,
  ) {}

  /** Count one API response, whether or not it reported usage. */
  add(raw: unknown): void {
    this.requests += 1
    const snapshot = normalizeUsage(this.kind, raw)
    if (!snapshot) return
    for (const [key, value] of Object.entries(snapshot)) {
      const field = key as keyof UsageSnapshot
      this.usage[field] = (this.usage[field] ?? 0) + (value as number)
    }
  }

  snapshot(): PhaseUsageSnapshot {
    return {
      usage: { ...this.usage },
      requests: this.requests,
      durationMs: Date.now() - this.startedAt,
    }
  }
}
