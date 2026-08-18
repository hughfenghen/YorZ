import type { ProjectListItem, WorktreeMeta } from './project.js'

export type SpecType = 'feat' | 'refct' | 'fix'

export type SpecStage = 'plan' | 'tasks' | 'execute' | 'done'

export interface SpecListItem {
  id: string
  title: string
  stage: SpecStage
  updated_at: string
  summary: string
  mtime: number
}

export interface SpecDetail {
  id: string
  frontmatter: {
    stage: SpecStage
    last_action: string
    updated_at: string
    summary: string
  }
  body: string
  mtime: number
}

export interface CreateSpecBody {
  type: SpecType
  title?: string
  summary?: string
  requirement?: string
  draftId?: string
}

export type AttachmentKind = 'image' | 'pdf' | 'text'

export interface AttachmentMeta {
  storedName: string
  name: string
  size: number
  mime: string
  kind: AttachmentKind
}

export interface AnnotationBody {
  sectionPath: string
  quote: string
  note: string
}

export interface QuestionAnswerBody {
  questionId?: string
  questionText: string
  selectedOptionLabel?: string
  note?: string
}

export interface QuestionAnswersBody {
  answers: QuestionAnswerBody[]
  freeformAnnotations: AnnotationBody[]
}

export type AppendItemKind = 'feat' | 'refct' | 'fix'

export interface AppendItemBody {
  kind: AppendItemKind
  description: string
  sectionPath?: string
  quote?: string
  autoRun?: boolean
  /** Only meaningful when kind === 'fix': enter Debug mode (yorz-debug skill). */
  debug?: boolean
}

export type GitOpsAction = 'commit' | 'discard' | 'stash'

export interface GitChange {
  path: string
  index: string
  worktree: string
  status: string
  renamedFrom?: string
}

export interface CreateWorktreeBody {
  specSlug: string
  branch?: string
}

export interface CreateWorktreeResponse {
  id: string
  name: string
  path: string
  lastActivityAt: string | null
  worktree: WorktreeMeta
  branch: string
  baseRef: string
}

export interface MergeWorktreeBody {
  commitMessage?: string
}

export type MergeWorktreeResponse =
  | { status: 'merged'; mainProjectId: string; mergeCommit: string }
  | {
      status: 'conflict'
      mainProjectId: string
      conflictSpecId: string
      conflictSpecPath: string
      conflictFiles: string[]
    }

export type AgentConfig =
  | { kind: 'inherit' }
  | { kind: 'claude' }
  | { kind: 'opencode' }
  | { kind: 'codex' }
  | { kind: 'custom'; cmd: string; args: string[] }

export interface CommandDef {
  id: string
  name: string
  cli: string
  createdAt: number
}

export type CommandRunStatus = 'running' | 'exited' | 'killed' | 'failed'

export interface CommandRun {
  runId: string
  commandId: string
  name: string
  cli: string
  pid: number
  status: CommandRunStatus
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  signal?: string | null
  /** POSIX path relative to the project root — pasteable into an agent prompt. */
  logFile: string
}

export interface CommandOutputSlice {
  offset: number
  text: string
  size: number
  truncated: boolean
}

export interface ProjectConfig {
  version: 1
  agent: AgentConfig
  specsDir: string
  /**
   * Managed by the command routes, not by the config dialog. Kept on the type
   * so a round-trip through this object cannot silently drop it.
   */
  commands: CommandDef[]
  /**
   * Project-scoped slash commands, managed by their own routes for the same
   * reason as `commands`.
   */
  customInstructions: CustomInstruction[]
}

export interface GlobalConfig {
  agent: {
    defaultKind: 'claude' | 'opencode' | 'codex'
  }
  notifications: {
    sessionEnd: {
      banner: boolean
      sound: boolean
    }
  }
  shortcuts: Partial<
    Record<'newSpec' | 'toggleSpecDetailFullscreen' | 'projectSettings', string | null>
  >
  power: {
    inhibitWhenRunning: 'system-default' | 'prevent-display-sleep' | 'keep-system-awake'
  }
  appearance: {
    themeMode: 'system' | 'light' | 'dark'
    themeName: 'terminal' | 'graphite' | 'paper'
    language: 'zh-CN' | 'en'
  }
  customInstructions: CustomInstruction[]
}

export interface CustomInstruction {
  id: string
  name: string
  description: string
  /** Appended on send, hidden from the composer and the chat bubble. */
  hiddenPrompt: string
  prefill: string
  createdAt: number
}

export interface FileCompletionResult {
  items: string[]
}

export type AgentKind = 'claude' | 'codex' | 'opencode'

export type SystemNotificationKind = 'version-update'
export type SystemNotificationAction = 'none' | 'update-available' | 'updating' | 'restart-ready'

export interface SystemNotification {
  id: string
  kind: SystemNotificationKind
  title: string
  message: string
  createdAt: number
  updatedAt: number
  action: SystemNotificationAction
  metadata?: Record<string, string>
}

export type AgentContextKind = 'recommended_plugins' | 'agents_instructions' | 'environment_context'

export interface SessionInfo {
  id: string
  title: string
  kind: AgentKind
  createdAt: number
  updatedAt: number
  specId?: string
  /** A turn is currently in flight for this session (transient list state). */
  running?: boolean
}

export interface AgentUsageWindow {
  key: string
  label: string
  utilization: number | null
  resetsAt: string | null
}

export interface AgentUsageStatus {
  kind: AgentKind
  status: 'available' | 'unavailable' | 'error'
  checkedAt: number
  source?: 'native-sdk' | 'private-api' | 'local-snapshot' | 'external-cli'
  subscriptionType?: string | null
  rateLimitsAvailable?: boolean
  windows?: AgentUsageWindow[]
  installCommand?: string
  message?: string
}

export type MessagePart =
  | { type: 'text'; text: string; contextKind?: AgentContextKind }
  | { type: 'tool-use'; name: string; input: unknown }
  | { type: 'tool-result'; text: string }

export interface SessionMessage {
  role: 'user' | 'assistant'
  parts: MessagePart[]
  ts?: number
}

function projectBase(pid: string): string {
  return `/api/projects/${encodeURIComponent(pid)}`
}

async function extractErrorDetail(res: Response): Promise<string> {
  const text = await res.text()
  if (!text) return ''
  try {
    const body = JSON.parse(text) as { error?: string }
    return body.error ?? text
  } catch {
    return text
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const detail = await extractErrorDetail(res)
    throw new Error(`${res.status} ${detail || res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listSpecs: (pid: string) => request<SpecListItem[]>(`${projectBase(pid)}/specs`),
  getSpec: (pid: string, id: string) =>
    request<SpecDetail>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}`),
  deleteSpec: (pid: string, id: string) =>
    request<{ ok: true }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  setStage: (pid: string, id: string, stage: SpecStage) =>
    request<{ ok: true }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/stage`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage }),
    }),
  createSpec: (
    pid: string,
    body: CreateSpecBody,
  ): Promise<
    { id: string; path: string; draft?: false } | { runId: string; sessionId: string; draft: true }
  > =>
    fetch(`${projectBase(pid)}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) {
        const detail = await extractErrorDetail(res)
        throw new Error(`${res.status} ${detail || res.statusText}`)
      }
      return res.json()
    }),
  appendAnnotation: (pid: string, id: string, body: AnnotationBody) =>
    request<{ ok: true }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/inputs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'annotate', ...body }),
    }),
  submitQuestionAnswers: (pid: string, id: string, body: QuestionAnswersBody) =>
    request<{ ok: true }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/questions/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  runAgent: (pid: string, id: string) =>
    request<{ runId: string; sessionId: string }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    ),
  appendItem: (pid: string, id: string, body: AppendItemBody) =>
    request<{ ok: true; runId?: string; sessionId?: string }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/appends`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
  explain: (pid: string, id: string, text: string) =>
    request<{ runId: string; sessionId: string }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/explain`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      },
    ),
  gitOp: (pid: string, id: string, action: GitOpsAction) =>
    request<{ runId: string; sessionId: string }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/git`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      },
    ),
  getChanges: (pid: string, id: string) =>
    request<{ changes: GitChange[] }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/changes`,
    ),
  directCommit: (pid: string, id: string, body: { message: string; paths: string[] }) =>
    request<{ commit: string }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  directDiscard: (pid: string, id: string, body: { paths: string[] }) =>
    request<{ ok: true }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/discard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  directStash: (pid: string, id: string, body: { message: string; paths: string[] }) =>
    request<{ ok: true }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/stash`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  getDebug: (pid: string, id: string) =>
    request<{ exists: boolean; text: string }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/debug`,
    ),
  listProjects: () => request<ProjectListItem[]>('/api/projects'),
  listSystemNotifications: () => request<SystemNotification[]>('/api/system-notifications'),
  deleteSystemNotification: (id: string) =>
    request<{ ok: true }>(`/api/system-notifications/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  updateSystemNotification: (id: string) =>
    request<SystemNotification>(`/api/system-notifications/${encodeURIComponent(id)}/update`, {
      method: 'POST',
    }),
  restartSystemNotification: (id: string) =>
    request<SystemNotification>(`/api/system-notifications/${encodeURIComponent(id)}/restart`, {
      method: 'POST',
    }),
  removeProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  removeProjectWithFiles: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}?deleteFiles=true`, {
      method: 'DELETE',
    }),
  createWorktree: (projectId: string, body: CreateWorktreeBody) =>
    request<CreateWorktreeResponse>(`/api/projects/${encodeURIComponent(projectId)}/worktrees`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  mergeWorktreeToMain: (projectId: string, body: MergeWorktreeBody) =>
    request<MergeWorktreeResponse>(`/api/projects/${encodeURIComponent(projectId)}/merge-main`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  getProjectConfig: (pid: string) =>
    request<ProjectConfig>(`/api/projects/${encodeURIComponent(pid)}/config`),
  updateProjectConfig: (pid: string, body: { agent: AgentConfig; specsDir: string }) =>
    request<{ ok: true; config: ProjectConfig }>(
      `/api/projects/${encodeURIComponent(pid)}/config`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
  getProjectCustomInstructions: (pid: string) =>
    request<{ customInstructions: CustomInstruction[] }>(
      `/api/projects/${encodeURIComponent(pid)}/custom-instructions`,
    ),
  updateProjectCustomInstructions: (pid: string, customInstructions: CustomInstruction[]) =>
    request<{ ok: true; customInstructions: CustomInstruction[] }>(
      `/api/projects/${encodeURIComponent(pid)}/custom-instructions`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customInstructions }),
      },
    ),
  getGlobalConfig: () => request<GlobalConfig>('/api/global-config'),
  updateGlobalConfig: (body: GlobalConfig) =>
    request<{ ok: true; config: GlobalConfig }>('/api/global-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  createDraft: (pid: string) =>
    request<{ draftId: string }>(`${projectBase(pid)}/spec-drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  uploadAttachment: async (pid: string, draftId: string, file: File): Promise<AttachmentMeta> => {
    const fd = new FormData()
    fd.append('file', file, file.name)
    const res = await fetch(
      `${projectBase(pid)}/spec-drafts/${encodeURIComponent(draftId)}/attachments`,
      {
        method: 'POST',
        body: fd,
      },
    )
    if (!res.ok) {
      const detail = await extractErrorDetail(res)
      throw new Error(`${res.status} ${detail || res.statusText}`)
    }
    return res.json() as Promise<AttachmentMeta>
  },
  deleteAttachment: (pid: string, draftId: string, storedName: string) =>
    request<{ ok: true }>(
      `${projectBase(pid)}/spec-drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(storedName)}`,
      { method: 'DELETE' },
    ),
  renameAttachment: (pid: string, draftId: string, storedName: string, name: string) =>
    request<AttachmentMeta>(
      `${projectBase(pid)}/spec-drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(storedName)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      },
    ),
  draftAttachmentUrl: (pid: string, draftId: string, storedName: string): string =>
    `${projectBase(pid)}/spec-drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(storedName)}`,
  specAttachmentUrl: (pid: string, specId: string, name: string): string =>
    `${projectBase(pid)}/specs/${encodeURIComponent(specId)}/attachments/${encodeURIComponent(name)}`,
  listFiles: (pid: string, query: string, limit = 50) =>
    request<FileCompletionResult>(
      `${projectBase(pid)}/files?query=${encodeURIComponent(query)}&limit=${limit}`,
    ),
  listSessions: (pid: string) => request<SessionInfo[]>(`${projectBase(pid)}/sessions`),
  getAgentUsageStatus: (pid: string) =>
    request<AgentUsageStatus>(`${projectBase(pid)}/agent-usage`),
  createSession: (pid: string, body: { title?: string; agentKind?: AgentKind } = {}) =>
    request<{ sessionId: string; kind: AgentKind }>(`${projectBase(pid)}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  getSessionMessages: (pid: string, sid: string) =>
    request<SessionMessage[]>(`${projectBase(pid)}/sessions/${encodeURIComponent(sid)}/messages`),
  sendSessionMessage: (pid: string, sid: string, prompt: string, draftId?: string) =>
    request<{ runId: string; sessionId: string }>(
      `${projectBase(pid)}/sessions/${encodeURIComponent(sid)}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draftId ? { prompt, draftId } : { prompt }),
      },
    ),
  abortSession: (pid: string, sid: string) =>
    request<{ aborted: boolean }>(`${projectBase(pid)}/sessions/${encodeURIComponent(sid)}/abort`, {
      method: 'POST',
    }),
  // Read-only probe: `sessionId` is null when the spec has no session yet
  // (sessions are created lazily, on the first system round).
  getSpecSession: (pid: string, id: string) =>
    request<{ sessionId: string | null; kind: AgentKind | null; running: boolean }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/session`,
    ),

  // ---- commands ----
  listCommands: (pid: string) => request<CommandDef[]>(`${projectBase(pid)}/commands`),
  createCommand: (pid: string, body: { name: string; cli: string }) =>
    request<CommandDef>(`${projectBase(pid)}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deleteCommand: (pid: string, commandId: string) =>
    request<{ ok: true }>(`${projectBase(pid)}/commands/${encodeURIComponent(commandId)}`, {
      method: 'DELETE',
    }),
  listCommandRuns: (pid: string) => request<CommandRun[]>(`${projectBase(pid)}/command-runs`),
  getCommandRun: (pid: string, runId: string) =>
    request<CommandRun>(`${projectBase(pid)}/command-runs/${encodeURIComponent(runId)}`),
  runCommand: (pid: string, commandId: string) =>
    request<CommandRun>(`${projectBase(pid)}/command-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId }),
    }),
  readCommandOutput: (pid: string, runId: string, offset?: number) =>
    request<CommandOutputSlice>(
      `${projectBase(pid)}/command-runs/${encodeURIComponent(runId)}/output${
        offset === undefined ? '' : `?offset=${offset}`
      }`,
    ),
  stopCommandRun: (pid: string, runId: string) =>
    request<{ ok: true; run: CommandRun }>(
      `${projectBase(pid)}/command-runs/${encodeURIComponent(runId)}/stop`,
      { method: 'POST' },
    ),
  clearCommandRun: (pid: string, runId: string) =>
    request<{ ok: true }>(`${projectBase(pid)}/command-runs/${encodeURIComponent(runId)}`, {
      method: 'DELETE',
    }),
}
