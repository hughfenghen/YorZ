/**
 * Telemetry event model.
 *
 * The envelope is deliberately tiny and stable; everything domain-specific
 * lives in a free-form payload that is flattened into the same JSON object so
 * `jq` can query it without digging. Adding a new observation point means
 * inventing a new `event` string — the recorder never needs to change.
 */

/** Schema version of the envelope. Bump on breaking field changes.
 *
 * `2` — `ts` became a numeric epoch and every project now shares one file. */
export const TELEMETRY_SCHEMA_VERSION = 2

/**
 * `<domain>.<action>`. The union documents the events shipped today while the
 * trailing `(string & {})` keeps the namespace open for future ones.
 *
 * `git.op` and `spec.change` used to live here and were dropped: together they
 * accounted for 99% of all recorded lines while feeding no metric.
 */
export type TelemetryEventName =
  | 'agent.dispatch'
  | 'agent.turn'
  | 'agent.compact'
  | 'spec.stage'
  | 'cmd.exec'
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
  /** Epoch milliseconds (`Date.now()`), matching the `durMs` / `mtimeMs` unit. */
  ts: number
  event: TelemetryEventName
  /** `generateProjectId(projectRoot)` — the only thing separating projects now
   * that every one of them appends to the same file. */
  projectId: string
  /** Correlates every event of one dispatch (reuses the existing `runId`). */
  traceId?: string
  durMs?: number
}

/** One entry of the `projects.json` index, mapping a short id back to a path. */
export interface ProjectMetricsMeta {
  path: string
  /** Epoch milliseconds of the first event recorded for this project. */
  firstSeenAt: number
}

/** `projects.json`: `projectId` → where that project lives on disk. */
export type ProjectsIndex = Record<string, ProjectMetricsMeta>
