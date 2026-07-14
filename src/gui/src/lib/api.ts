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
  | { kind: 'claude' }
  | { kind: 'opencode' }
  | { kind: 'codex' }
  | { kind: 'custom'; cmd: string; args: string[] }

export interface ProjectConfig {
  version: 1
  agent: AgentConfig
  specsDir: string
}

export interface FileCompletionResult {
  items: string[]
}

export type AgentKind = 'claude' | 'codex' | 'opencode'

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

export type MessagePart =
  | { type: 'text'; text: string }
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
  triggerReview: (pid: string, id: string) =>
    request<{ runId: string; sessionId: string }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/review`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
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
  getReview: (pid: string, id: string) =>
    request<{ text: string }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/review`),
  listProjects: () => request<ProjectListItem[]>('/api/projects'),
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
  createSession: (pid: string, body: { title?: string; agentKind?: AgentKind } = {}) =>
    request<{ sessionId: string; kind: AgentKind }>(`${projectBase(pid)}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  getSessionMessages: (pid: string, sid: string) =>
    request<SessionMessage[]>(
      `${projectBase(pid)}/sessions/${encodeURIComponent(sid)}/messages`,
    ),
  sendSessionMessage: (pid: string, sid: string, prompt: string) =>
    request<{ runId: string; sessionId: string }>(
      `${projectBase(pid)}/sessions/${encodeURIComponent(sid)}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      },
    ),
  abortSession: (pid: string, sid: string) =>
    request<{ aborted: boolean }>(
      `${projectBase(pid)}/sessions/${encodeURIComponent(sid)}/abort`,
      { method: 'POST' },
    ),
  // Read-only probe: `sessionId` is null when the spec has no session yet
  // (sessions are created lazily, on the first system round).
  getSpecSession: (pid: string, id: string) =>
    request<{ sessionId: string | null; kind: AgentKind | null }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/session`,
    ),
}
