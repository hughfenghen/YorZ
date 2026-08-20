import type { AgentKind } from '../agent-sdk/types.js'
import type { UsageSnapshot } from './types.js'

/**
 * Map each agent's own usage shape onto {@link UsageSnapshot}.
 *
 * Normalization happens here, at the adapter boundary, so no consumer ever has
 * to branch on `AgentKind`. Fields the source does not report stay `undefined`
 * rather than becoming `0` — "not measured" and "measured as zero" answer very
 * different questions about cache behaviour.
 */
export function normalizeUsage(kind: AgentKind, raw: unknown): UsageSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const snapshot =
    kind === 'codex'
      ? fromCodex(obj)
      : kind === 'opencode'
        ? fromOpenCode(obj)
        : fromClaude(obj)
  return isEmpty(snapshot) ? undefined : snapshot
}

/** Claude Agent SDK `NonNullableUsage` (snake_case, Messages API shape). */
function fromClaude(u: Record<string, unknown>): UsageSnapshot {
  return compact({
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreateTokens: num(u.cache_creation_input_tokens),
  })
}

/** Codex `turn.completed` usage. `cached_input_tokens` is a subset of input. */
function fromCodex(u: Record<string, unknown>): UsageSnapshot {
  const total = num(u.input_tokens)
  const cached = num(u.cached_input_tokens)
  // Codex reports total input including the cached part; split it so the
  // `inputTokens` field keeps its "full-price only" meaning across agents.
  const uncached =
    total !== undefined && cached !== undefined ? Math.max(total - cached, 0) : total
  return compact({
    inputTokens: uncached,
    cacheReadTokens: cached,
    outputTokens: num(u.output_tokens),
    reasoningTokens: num(u.reasoning_output_tokens),
  })
}

/** OpenCode `message.info.tokens`. */
function fromOpenCode(u: Record<string, unknown>): UsageSnapshot {
  const cache = u.cache && typeof u.cache === 'object' ? (u.cache as Record<string, unknown>) : {}
  return compact({
    inputTokens: num(u.input),
    outputTokens: num(u.output),
    reasoningTokens: num(u.reasoning),
    cacheReadTokens: num(cache.read),
    cacheCreateTokens: num(cache.write),
  })
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Drop `undefined` keys so a JSONL line never carries empty measurements. */
function compact(snapshot: UsageSnapshot): UsageSnapshot {
  const out: UsageSnapshot = {}
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) out[key as keyof UsageSnapshot] = value
  }
  return out
}

function isEmpty(snapshot: UsageSnapshot): boolean {
  return Object.keys(snapshot).length === 0
}
