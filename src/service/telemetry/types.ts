/**
 * Telemetry event model.
 *
 * The envelope is deliberately tiny and stable; everything domain-specific
 * lives in a free-form payload that is flattened into the same JSON object so
 * `jq` can query it without digging. Adding a new observation point means
 * inventing a new `event` string — the recorder never needs to change.
 */

/** Schema version of the envelope. Bump on breaking field changes. */
export const TELEMETRY_SCHEMA_VERSION = 1

/**
 * `<domain>.<action>`. The union documents the events shipped today while the
 * trailing `(string & {})` keeps the namespace open for future ones.
 */
export type TelemetryEventName =
  | 'agent.dispatch'
  | 'agent.turn'
  | 'agent.compact'
  | 'spec.stage'
  | 'spec.change'
  | 'cmd.exec'
  | 'git.op'
  | 'lint.run'
  | (string & {})

/**
 * Normalized token usage. Every field is optional on purpose: a field left
 * `undefined` means "this agent did not report it", which must stay
 * distinguishable from a reported zero (otherwise cache-hit ratios lie).
 */
export interface UsageSnapshot {
  /** Full-price input tokens (cache misses only). */
  inputTokens?: number
  /** Tokens served from the prompt cache (~0.1x price). */
  cacheReadTokens?: number
  /** Tokens written to the prompt cache (~1.25x price). */
  cacheCreateTokens?: number
  outputTokens?: number
  /** Reasoning tokens, when the agent reports them separately. */
  reasoningTokens?: number
  costUsd?: number
}

/** Per-model usage buckets, kept verbatim from the agent that produced them. */
export type ModelUsageMap = Record<string, unknown>

/** Metrics carried by a completed turn, produced at the adapter boundary. */
export interface TurnMetrics {
  usage?: UsageSnapshot
  modelUsage?: ModelUsageMap
  numTurns?: number
  stopReason?: string
  model?: string
  durationMs?: number
  apiDurationMs?: number
}

/** Metrics carried by an auto/manual context-compaction boundary. */
export interface CompactMetrics {
  trigger?: 'auto' | 'manual'
  preTokens?: number
  postTokens?: number
  durationMs?: number
}

/** Free-form event body. Flattened into the envelope on write. */
export type TelemetryPayload = Record<string, unknown>

/** One JSONL line. */
export interface TelemetryEnvelope extends TelemetryPayload {
  /** Schema version — see {@link TELEMETRY_SCHEMA_VERSION}. */
  v: number
  /** Local `YYYY-MM-DD HH:mm:ss`, same shape as spec frontmatter `updated_at`. */
  ts: string
  event: TelemetryEventName
  /** `generateProjectId(projectRoot)`; redundant with the directory name so
   * merged files stay attributable. */
  projectId: string
  /** Correlates every event of one dispatch (reuses the existing `runId`). */
  traceId?: string
  durMs?: number
}

/** Sidecar written once per project directory, mapping the short id back. */
export interface ProjectMetricsMeta {
  id: string
  path: string
  firstSeenAt: string
}
