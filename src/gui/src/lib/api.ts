import type { ProjectListItem, WorktreeMeta } from './project.js'

export type SpecType = 'feat' | 'refct' | 'fix'

export interface SpecListItem {
  id: string
  title: string
  stage: 'plan' | 'tasks' | 'execute'
  updated_at: string
  summary: string
  mtime: number
}

export interface SpecDetail {
  id: string
  frontmatter: {
    stage: 'plan' | 'tasks' | 'execute'
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

export type AgentLogMode = 'skill-run' | 'explain' | 'review' | 'git-ops'

export interface AgentLogMeta {
  runId: string
  specId: string
  mode: AgentLogMode
  /** Sub-action when mode === 'git-ops'. Absent for legacy modes. */
  action?: GitOpsAction
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  error?: string
  sizeBytes: number
}

export interface AgentLogPayload {
  meta: AgentLogMeta
  content: string
  truncated: boolean
}

export type AgentConfig =
  | { kind: 'claude' }
  | { kind: 'opencode' }
  | { kind: 'custom'; cmd: string; args: string[] }

export interface ProjectConfig {
  version: 1
  agent: AgentConfig
  specsDir: string
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
  createSpec: (
    pid: string,
    body: CreateSpecBody,
  ): Promise<{ id: string; path: string; draft?: false } | { runId: string; draft: true }> =>
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
    request<{ runId: string }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  appendItem: (pid: string, id: string, body: AppendItemBody) =>
    request<{ ok: true; runId?: string }>(
      `${projectBase(pid)}/specs/${encodeURIComponent(id)}/appends`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
  explain: (pid: string, id: string, text: string) =>
    request<{ runId: string }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  triggerReview: (pid: string, id: string) =>
    request<{ runId: string }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  gitOp: (pid: string, id: string, action: GitOpsAction) =>
    request<{ runId: string }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/git`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
  getReview: (pid: string, id: string) =>
    request<{ text: string }>(`${projectBase(pid)}/specs/${encodeURIComponent(id)}/review`),
  listProjects: () => request<ProjectListItem[]>('/api/projects'),
  removeProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
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
  listAgentLogs: (pid: string, specId: string) =>
    request<AgentLogMeta[]>(`${projectBase(pid)}/specs/${encodeURIComponent(specId)}/agent-logs`),
  getAgentLog: (pid: string, specId: string, runId: string) =>
    request<AgentLogPayload>(
      `${projectBase(pid)}/specs/${encodeURIComponent(specId)}/agent-logs/${encodeURIComponent(runId)}`,
    ),
}
