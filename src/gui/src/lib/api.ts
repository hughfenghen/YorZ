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
  title: string
  type: 'feat' | 'refct' | 'fix'
  summary: string
  requirement?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      detail = body.error ?? ''
    } catch {
      detail = await res.text()
    }
    throw new Error(`${res.status} ${detail || res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  listSpecs: () => request<SpecListItem[]>('/api/specs'),
  getSpec: (id: string) => request<SpecDetail>(`/api/specs/${encodeURIComponent(id)}`),
  createSpec: (body: CreateSpecBody) =>
    request<{ id: string; path: string }>('/api/specs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  appendNote: (id: string, content: string) =>
    request<{ ok: true }>(`/api/specs/${encodeURIComponent(id)}/inputs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'append-note', content }),
    }),
  getProject: () => request<{ cwd: string; name: string }>('/api/projects/current'),
}
