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
  listSpecs: () => request<SpecListItem[]>('/api/specs'),
  getSpec: (id: string) => request<SpecDetail>(`/api/specs/${encodeURIComponent(id)}`),
  createSpec: (
    body: CreateSpecBody,
  ): Promise<{ id: string; path: string; draft?: false } | { runId: string; draft: true }> =>
    fetch('/api/specs', {
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
  appendAnnotation: (id: string, body: AnnotationBody) =>
    request<{ ok: true }>(`/api/specs/${encodeURIComponent(id)}/inputs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'annotate', ...body }),
    }),
  submitQuestionAnswers: (id: string, body: QuestionAnswersBody) =>
    request<{ ok: true }>(`/api/specs/${encodeURIComponent(id)}/questions/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  runAgent: (id: string) =>
    request<{ runId: string }>(`/api/specs/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  explain: (id: string, text: string) =>
    request<{ runId: string }>(`/api/specs/${encodeURIComponent(id)}/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  getProject: () => request<{ cwd: string; name: string }>('/api/projects/current'),
}
