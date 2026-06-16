import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'

export type SpecType = 'feat' | 'refct' | 'fix'

export interface SpecFrontmatter {
  stage: 'plan' | 'tasks' | 'execute'
  last_action: string
  updated_at: string
  summary: string
}

export interface SpecListItem {
  id: string
  title: string
  stage: SpecFrontmatter['stage']
  updated_at: string
  summary: string
  mtime: number
}

export interface SpecDetail {
  id: string
  frontmatter: SpecFrontmatter
  body: string
  mtime: number
}

export interface CreateSpecInput {
  type: SpecType
  title?: string
  summary?: string
  requirement?: string
}

export interface AnnotationInput {
  sectionPath: string
  quote: string
  note: string
}

export interface SpecStoreOptions {
  cwd: string
  /** Hook for echo suppression on writes. */
  onWrite?: (filePath: string, mtimeMs: number) => void
  /** Override of "now" for deterministic tests. */
  now?: () => Date
}

const SECTIONS = [
  '## 背景',
  '## 需求',
  '## 现状分析',
  '## 技术实现方案',
  '## 待确认问题',
  '## 任务清单',
  '## 执行记录',
]

export class SpecStore {
  private readonly root: string
  private readonly onWrite?: SpecStoreOptions['onWrite']
  private readonly now: () => Date

  constructor(opts: SpecStoreOptions) {
    this.root = join(opts.cwd, '.yorz', 'specs')
    this.onWrite = opts.onWrite
    this.now = opts.now ?? (() => new Date())
  }

  get specsDir(): string {
    return this.root
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  async list(): Promise<SpecListItem[]> {
    await this.ensureRoot()
    const entries = await readdir(this.root, { withFileTypes: true })
    const items: SpecListItem[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const filePath = join(this.root, entry.name, 'spec.md')
      if (!existsSync(filePath)) continue
      const stats = await stat(filePath)
      const raw = await readFile(filePath, 'utf8')
      const parsed = matter(raw)
      const fm = normalizeFrontmatter(parsed.data)
      items.push({
        id: entry.name,
        title: extractTitle(parsed.content) ?? entry.name,
        stage: fm.stage,
        updated_at: fm.updated_at,
        summary: fm.summary,
        mtime: stats.mtimeMs,
      })
    }
    items.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    return items
  }

  async read(id: string): Promise<SpecDetail | null> {
    const filePath = this.specPath(id)
    if (!existsSync(filePath)) return null
    const stats = await stat(filePath)
    const raw = await readFile(filePath, 'utf8')
    const parsed = matter(raw)
    return {
      id,
      frontmatter: normalizeFrontmatter(parsed.data),
      body: parsed.content.replace(/^\n+/, ''),
      mtime: stats.mtimeMs,
    }
  }

  async create(input: CreateSpecInput): Promise<{ id: string; path: string }> {
    await this.ensureRoot()
    const requirement = input.requirement?.trim() ?? ''
    const title = (input.title?.trim() || placeholderTitle(requirement)).slice(0, 80)
    const summary = (input.summary?.trim() || placeholderSummary(requirement)).slice(0, 200)
    const slugSource = requirement || title
    const id = await this.allocateId(input.type, slugSource)
    const dir = join(this.root, id)
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, 'spec.md')
    const content = renderInitialSpec(
      { type: input.type, title, summary, requirement: input.requirement },
      this.today(),
    )
    await this.write(filePath, content)
    return { id, path: filePath }
  }

  async appendAnnotation(id: string, input: AnnotationInput): Promise<void> {
    const filePath = this.specPath(id)
    if (!existsSync(filePath)) throw new Error(`spec not found: ${id}`)
    const sectionPath = input.sectionPath.trim() || '(无章节)'
    const quote = input.quote.trim().slice(0, 200)
    const note = input.note.trim()
    if (!quote) throw new Error('quote required')
    if (!note) throw new Error('note required')
    const raw = await readFile(filePath, 'utf8')
    const parsed = matter(raw)
    const existing = normalizeFrontmatter(parsed.data)
    const fm: SpecFrontmatter = {
      stage: 'plan',
      last_action: '用户新增批注 ！！！',
      updated_at: this.today(),
      summary: existing.summary,
    }
    const block = `\n\n> ${sectionPath} 中 "${quote}"\n>\n> ！！！${note}\n`
    const next = serializeSpec(fm, parsed.content.replace(/\n+$/, '') + block)
    await this.write(filePath, next)
  }

  specPath(id: string): string {
    return join(this.root, id, 'spec.md')
  }

  private async allocateId(type: SpecType, summary: string): Promise<string> {
    const slug = kebab(summary)
    const base = `${this.todayCompact()}.${type}.${slug}`
    let id = base
    let n = 2
    while (existsSync(join(this.root, id))) {
      id = `${base}-${n}`
      n += 1
    }
    return id
  }

  private async write(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf8')
    if (this.onWrite) {
      const stats = await stat(filePath)
      this.onWrite(filePath, stats.mtimeMs)
    }
  }

  private today(): string {
    return formatDate(this.now())
  }

  private todayCompact(): string {
    const d = this.now()
    const y = String(d.getFullYear()).slice(-2)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}${m}${day}`
  }
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function kebab(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (!slug || /^[0-9]/.test(slug)) return `spec-${slug || Date.now()}`
  return slug
}

function extractTitle(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}

function normalizeFrontmatter(data: Record<string, unknown>): SpecFrontmatter {
  const stage = data.stage
  const last_action = data.last_action
  const updated_at = data.updated_at
  const summary = data.summary
  return {
    stage: stage === 'tasks' || stage === 'execute' ? stage : 'plan',
    last_action: typeof last_action === 'string' ? last_action : '',
    updated_at: dateString(updated_at),
    summary: typeof summary === 'string' ? summary : '',
  }
}

function dateString(value: unknown): string {
  if (value instanceof Date) return formatDate(value)
  if (typeof value === 'string') return value
  return ''
}

function serializeSpec(fm: SpecFrontmatter, body: string): string {
  const head = [
    '---',
    `stage: ${fm.stage}`,
    `last_action: ${fm.last_action}`,
    `updated_at: ${fm.updated_at}`,
    `summary: ${fm.summary}`,
    '---',
    '',
  ].join('\n')
  return `${head}${body.startsWith('\n') ? '' : '\n'}${body}${body.endsWith('\n') ? '' : '\n'}`
}

function renderInitialSpec(
  input: { type: SpecType; title: string; summary: string; requirement?: string },
  today: string,
): string {
  const fm: SpecFrontmatter = {
    stage: 'plan',
    last_action: '新建 spec',
    updated_at: today,
    summary: input.summary,
  }
  const sections = SECTIONS.map((heading) => {
    if (heading === '## 背景' && input.requirement?.trim()) {
      return `${heading}\n\n${input.requirement.trim()}\n`
    }
    return `${heading}\n\n`
  }).join('\n')
  const body = `# ${input.title}\n\n${sections}`
  return serializeSpec(fm, body)
}

function placeholderTitle(requirement: string): string {
  if (!requirement) return '（待 Agent 补全）'
  const firstLine = requirement.split(/\r?\n/)[0]?.trim() ?? ''
  if (!firstLine) return '（待 Agent 补全）'
  return firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine
}

function placeholderSummary(requirement: string): string {
  if (!requirement) return '（待 Agent 补全）'
  const firstParagraph =
    requirement
      .split(/\n{2,}/)[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? ''
  if (!firstParagraph) return '（待 Agent 补全）'
  return firstParagraph.length > 200 ? `${firstParagraph.slice(0, 199)}…` : firstParagraph
}
