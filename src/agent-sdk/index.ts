/**
 * Public contract for YorZ Agent SDK adapters — the `@yorz/cli/agent-sdk`
 * entry point.
 *
 * External agents are loaded by dynamic `import()` (declared globally in
 * `~/.config/yorz/config.json`'s `customAgents`, independent of any project).
 * Their module must default- or named-export a `createAgentAdapter` factory of
 * type {@link CreateAgentAdapter}
 * that returns an {@link AgentSdkAdapter}. Everything on that contract is
 * mandatory except `getUsageStatus`.
 *
 * ```ts
 * import type { CreateAgentAdapter } from '@yorz/cli/agent-sdk'
 *
 * export const createAgentAdapter: CreateAgentAdapter = (ctx) => ({
 *   descriptor: {
 *     id: ctx.descriptor.id,
 *     displayName: 'My Agent',
 *     source: 'external',
 *     capabilities: { listSessions: false, getMessages: false, usageStatus: false },
 *   },
 *   capabilities() { return this.descriptor.capabilities },
 *   async createSession() { ... },
 *   async resumeSession(id) { ... },
 *   async listSessions() { return [] },
 *   async getMessages(id) { return [] },
 *   async dispose() {},
 * })
 * export default createAgentAdapter
 * ```
 */

export type {
  AgentId,
  BuiltinAgentId,
  AgentKind,
  AgentDescriptor,
  AgentAdapterContext,
  CreateAgentAdapter,
  AgentSdkAdapter,
  AgentSession,
  AgentEvent,
  MessagePart,
  NormalizedMessage,
  SessionInfo,
  Capabilities,
  SendOptions,
  AgentContextKind,
  AgentUsageStatus,
  AgentUsageStatusKind,
  AgentUsageWindow,
} from '../service/agent-sdk/types.js'

export { BUILTIN_AGENT_IDS, isBuiltinAgentId } from '../service/agent-sdk/types.js'

// Metrics types an adapter attaches to `turn-completed` / `compact` events.
export type {
  TurnMetrics,
  CompactMetrics,
  UsageSnapshot,
  PhaseUsageSnapshot,
  ModelUsageMap,
} from '../service/telemetry/types.js'
