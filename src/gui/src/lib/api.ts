import { currentProjectId, type ProjectListItem } from './project.js'

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

export interface GitChange {
  path: string
  index: string
  worktree: string
  status: string
  renamedFrom?: string
}

export interface CommitBody {
  message: string
  paths?: string[]
}

function projectBase(): string | null {
  const pid = currentProjectId()
  return pid ? `/api/projects/${encodeURIComponent(pid)}` : null
}

function listReq<T>(builder: (base: string) => Promise<T>, fallback: T): Promise<T> {
  const base = projectBase()
  if (!base) return Promise.resolve(fallback)
  return builder(base)
}

function opReq<T>(builder: (base: string) => Promise<T>): Promise<T> {
  const base = projectBase()
  if (!base) return Promise.reject(new Error('no active project'))
  return builder(base)
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
  listSpecs: () => listReq<SpecListItem[]>((base) => request<SpecListItem[]>(`${base}/specs`), []),
  getSpec: (id: string) =>
    opReq<SpecDetail>((base) => request<SpecDetail>(`${base}/specs/${encodeURIComponent(id)}`)),
  createSpec: (
    body: CreateSpecBody,
  ): Promise<{ id: string; path: string; draft?: false } | { runId: string; draft: true }> =>
    opReq((base) =>
      fetch(`${base}/specs`, {
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
    ),
  appendAnnotation: (id: string, body: AnnotationBody) =>
    opReq<{ ok: true }>((base) =>
      request<{ ok: true }>(`${base}/specs/${encodeURIComponent(id)}/inputs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'annotate', ...body }),
      }),
    ),
  submitQuestionAnswers: (id: string, body: QuestionAnswersBody) =>
    opReq<{ ok: true }>((base) =>
      request<{ ok: true }>(`${base}/specs/${encodeURIComponent(id)}/questions/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  runAgent: (id: string) =>
    opReq<{ runId: string }>((base) =>
      request<{ runId: string }>(`${base}/specs/${encodeURIComponent(id)}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ),
  appendItem: (id: string, body: AppendItemBody) =>
    opReq<{ ok: true; runId?: string }>((base) =>
      request<{ ok: true; runId?: string }>(`${base}/specs/${encodeURIComponent(id)}/appends`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  explain: (id: string, text: string) =>
    opReq<{ runId: string }>((base) =>
      request<{ runId: string }>(`${base}/specs/${encodeURIComponent(id)}/explain`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      }),
    ),
  listSpecChanges: (id: string) =>
    listReq<{ changes: GitChange[] }>(
      (base) =>
        request<{ changes: GitChange[] }>(`${base}/specs/${encodeURIComponent(id)}/changes`),
      { changes: [] },
    ),
  commitSpecChanges: (id: string, body: CommitBody) =>
    opReq<{ ok: true; commit: string }>((base) =>
      request<{ ok: true; commit: string }>(`${base}/specs/${encodeURIComponent(id)}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    ),
  listProjects: () => request<ProjectListItem[]>('/api/projects'),
  addProject: (path: string) =>
    request<ProjectListItem>('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
  removeProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createDraft: () =>
    opReq<{ draftId: string }>((base) =>
      request<{ draftId: string }>(`${base}/spec-drafts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    ),
  uploadAttachment: async (draftId: string, file: File): Promise<AttachmentMeta> => {
    const base = projectBase()
    if (!base) throw new Error('no active project')
    const fd = new FormData()
    fd.append('file', file, file.name)
    const res = await fetch(`${base}/spec-drafts/${encodeURIComponent(draftId)}/attachments`, {
      method: 'POST',
      body: fd,
    })
    if (!res.ok) {
      const detail = await extractErrorDetail(res)
      throw new Error(`${res.status} ${detail || res.statusText}`)
    }
    return res.json() as Promise<AttachmentMeta>
  },
  deleteAttachment: (draftId: string, storedName: string) =>
    opReq<{ ok: true }>((base) =>
      request<{ ok: true }>(
        `${base}/spec-drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(storedName)}`,
        { method: 'DELETE' },
      ),
    ),
  renameAttachment: (draftId: string, storedName: string, name: string) =>
    opReq<AttachmentMeta>((base) =>
      request<AttachmentMeta>(
        `${base}/spec-drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(storedName)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      ),
    ),
  draftAttachmentUrl: (draftId: string, storedName: string): string => {
    const base = projectBase()
    if (!base) return ''
    return `${base}/spec-drafts/${encodeURIComponent(draftId)}/attachments/${encodeURIComponent(storedName)}`
  },
  specAttachmentUrl: (specId: string, name: string): string => {
    const base = projectBase()
    if (!base) return ''
    return `${base}/specs/${encodeURIComponent(specId)}/attachments/${encodeURIComponent(name)}`
  },
}
