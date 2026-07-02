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

export interface QuestionAnswerInput {
  questionId?: string
  questionText: string
  selectedOptionLabel?: string
  note?: string
}

export interface QuestionAnswersPayload {
  answers: QuestionAnswerInput[]
  freeformAnnotations: AnnotationInput[]
}

export interface SpecStoreOptions {
  cwd: string
  /**
   * Absolute path to the spec directory. When omitted, defaults to
   * `<cwd>/.yorz/specs` to preserve legacy behaviour.
   */
  specsDir?: string
  /** Hook for echo suppression on writes. */
  onWrite?: (filePath: string, mtimeMs: number) => void
  /** Override of "now" for deterministic tests. */
  now?: () => Date
}

// `## 追加任务` 由用户额外操作产生，不在初始化骨架中；首次追加时由 `mergeAppendTasksEntry`
// 在 `## 任务清单` 与 `## 执行记录` 之间懒插入。
const SECTIONS = [
  '## 背景',
  '## 需求',
  '## 现状分析',
  '## 技术实现方案',
  '## 待确认问题',
  '## 任务清单',
  '## 执行记录',
]

export type AppendKind = 'feat' | 'refct' | 'fix'

export interface AppendItemInput {
  kind: AppendKind
  description: string
  sectionPath?: string
  quote?: string
}

export class SpecStore {
  private readonly root: string
  private readonly onWrite?: SpecStoreOptions['onWrite']
  private readonly now: () => Date

  constructor(opts: SpecStoreOptions) {
    this.root = opts.specsDir ?? join(opts.cwd, '.yorz', 'specs')
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
    items.sort((a, b) => {
      if (a.updated_at < b.updated_at) return 1
      if (a.updated_at > b.updated_at) return -1
      // Tie-break by file mtime so equal/empty updated_at still yields a
      // deterministic "most-recently-touched first" order.
      return b.mtime - a.mtime
    })
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
      this.nowDateTime(),
    )
    await this.write(filePath, content)
    return { id, path: filePath }
  }

  async applyQuestionAnswers(id: string, payload: QuestionAnswersPayload): Promise<void> {
    const filePath = this.specPath(id)
    if (!existsSync(filePath)) throw new Error(`spec not found: ${id}`)
    const answers = payload.answers ?? []
    const freeforms = payload.freeformAnnotations ?? []
    if (answers.length === 0 && freeforms.length === 0) {
      throw new Error('answers or freeformAnnotations required')
    }
    const blocks: string[] = []
    for (const a of answers) {
      const text = a.questionText?.trim()
      if (!text) throw new Error('questionText required')
      const choice = a.selectedOptionLabel?.trim() ?? ''
      const note = a.note?.trim() ?? ''
      if (!choice && !note) throw new Error('selectedOptionLabel or note required')
      const reply = [choice ? `选择：${choice}` : '', note ? `备注：${note}` : '']
        .filter(Boolean)
        .join('；')
      blocks.push(`> 待确认问题："${text}"\n>\n> ！！！${reply}`)
    }
    for (const f of freeforms) {
      const sectionPath = f.sectionPath.trim() || '(无章节)'
      const quote = f.quote.trim().slice(0, 200)
      const note = f.note.trim()
      if (!quote) throw new Error('quote required')
      if (!note) throw new Error('note required')
      blocks.push(`> ${sectionPath} 中 "${quote}"\n>\n> ！！！${note}`)
    }
    const raw = await readFile(filePath, 'utf8')
    const parsed = matter(raw)
    const existing = normalizeFrontmatter(parsed.data)
    const fm: SpecFrontmatter = {
      stage: 'plan',
      last_action: '用户批量答复待确认问题',
      updated_at: this.nowDateTime(),
      summary: existing.summary,
    }
    const merged = mergeUserAnnotations(parsed.content, blocks)
    const next = serializeSpec(fm, merged)
    await this.write(filePath, next)
  }

  async appendItem(id: string, input: AppendItemInput): Promise<void> {
    const filePath = this.specPath(id)
    if (!existsSync(filePath)) throw new Error(`spec not found: ${id}`)
    const kind = input.kind
    if (kind !== 'feat' && kind !== 'refct' && kind !== 'fix') {
      throw new Error('kind must be feat | refct | fix')
    }
    const description = (input.description ?? '').trim()
    if (!description) throw new Error('description required')
    if (description.length > 4000) throw new Error('description too long (max 4000)')
    const sectionPath = input.sectionPath?.trim() ?? ''
    const quote = input.quote?.trim() ?? ''
    if (quote.length > 500) throw new Error('quote too long (max 500)')
    const raw = await readFile(filePath, 'utf8')
    const parsed = matter(raw)
    const existing = normalizeFrontmatter(parsed.data)
    const fm: SpecFrontmatter = {
      stage: 'plan',
      last_action: `追加任务（${kind}）`,
      updated_at: this.nowDateTime(),
      summary: existing.summary,
    }
    const firstLine = description.split(/\r?\n/)[0]!.slice(0, 80)
    const stamp = this.timestamp()
    const lines = [`- [open] [${kind}] ${stamp} | ${firstLine}`]
    lines.push(`  - 描述：${description}`)
    if (sectionPath) lines.push(`  - 引用：${sectionPath}`)
    if (quote) lines.push(`  - 引用原文：> ${quote}`)
    const entry = lines.join('\n')
    const merged = mergeAppendTasksEntry(parsed.content, entry)
    const next = serializeSpec(fm, merged)
    await this.write(filePath, next)
  }

  async appendExecutionLog(id: string, line: string): Promise<void> {
    const filePath = this.specPath(id)
    if (!existsSync(filePath)) throw new Error(`spec not found: ${id}`)
    const trimmed = line.trim()
    if (!trimmed) throw new Error('line required')
    const raw = await readFile(filePath, 'utf8')
    const parsed = matter(raw)
    const existing = normalizeFrontmatter(parsed.data)
    const fm: SpecFrontmatter = {
      stage: existing.stage,
      last_action: '提交 git',
      updated_at: this.nowDateTime(),
      summary: existing.summary,
    }
    const merged = appendExecutionLogToBody(parsed.content, `- ${trimmed}`)
    const next = serializeSpec(fm, merged)
    await this.write(filePath, next)
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
      updated_at: this.nowDateTime(),
      summary: existing.summary,
    }
    const block = `> ${sectionPath} 中 "${quote}"\n>\n> ！！！${note}`
    const merged = mergeUserAnnotations(parsed.content, [block])
    const next = serializeSpec(fm, merged)
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

  private nowDateTime(): string {
    return formatDateTime(this.now())
  }

  private timestamp(): string {
    return formatDateTime(this.now())
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

function formatDateTime(d: Date): string {
  const date = formatDate(d)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${date} ${hh}:${mm}:${ss}`
}

function kebab(text: string): string {
  const lower = text.toLowerCase()
  // Defensive: when the source is mostly non-ASCII (e.g. a Chinese requirement),
  // skip kebab-fication. Otherwise we get garbage like "spec-agent-spec-agent-ag"
  // assembled from English tokens that happened to appear inside the CJK prose.
  const noSpace = lower.replace(/\s+/g, '')
  const asciiAlphaNum = (noSpace.match(/[a-z0-9]/g) ?? []).length
  const ratio = noSpace.length ? asciiAlphaNum / noSpace.length : 0
  if (ratio < 0.5) return 'untitled'

  const slug = lower
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
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
  // Historical `YYYY-MM-DD` values are parsed as Date by gray-matter (YAML 1.1
  // timestamp); fall back to YYYY-MM-DD for backwards compatibility.
  if (value instanceof Date) return formatDate(value)
  // Newer `YYYY-MM-DD HH:mm:ss` values are written quoted in serializeSpec, so
  // they round-trip as strings — return them untouched (no trimming).
  if (typeof value === 'string') return value
  return ''
}

const USER_ANNOTATION_HEADING_RE = /^##\s+(?:\d+(?:\.\d+)*\.?\s+)?用户批注\s*$/m
const APPEND_TASKS_HEADING_RE = /^##\s+(?:\d+(?:\.\d+)*\.?\s+)?追加任务\s*$/m
const EXEC_RECORD_HEADING_RE = /^##\s+(?:\d+(?:\.\d+)*\.?\s+)?执行记录\s*$/m

function mergeAppendTasksEntry(content: string, entry: string): string {
  const body = content.replace(/^\n+/, '').replace(/\n+$/, '')
  const heading = '## 追加任务'
  const existing = APPEND_TASKS_HEADING_RE.exec(body)
  if (existing) {
    const headingStart = existing.index
    const after = body.slice(headingStart + existing[0].length)
    const nextH2 = /\n##\s+/.exec(after)
    const sectionEnd = nextH2 ? headingStart + existing[0].length + nextH2.index : body.length
    const before = body.slice(0, sectionEnd).replace(/\n+$/, '')
    const tail = body.slice(sectionEnd)
    return `${before}\n${entry}${tail ? `\n${tail}` : '\n'}`
  }
  // Section missing: insert before `## 执行记录` if it exists, otherwise append at end.
  const block = `${heading}\n\n${entry}\n`
  const exec = EXEC_RECORD_HEADING_RE.exec(body)
  if (exec) {
    const before = body.slice(0, exec.index).replace(/\n+$/, '')
    const tail = body.slice(exec.index)
    return `${before}\n\n${block}\n${tail}`
  }
  return `${body}\n\n${block}`
}

function appendExecutionLogToBody(content: string, entry: string): string {
  const body = content.replace(/^\n+/, '').replace(/\n+$/, '')
  const heading = '## 执行记录'
  const existing = EXEC_RECORD_HEADING_RE.exec(body)
  if (existing) {
    const headingStart = existing.index
    const after = body.slice(headingStart + existing[0].length)
    const nextH2 = /\n##\s+/.exec(after)
    const sectionEnd = nextH2 ? headingStart + existing[0].length + nextH2.index : body.length
    const before = body.slice(0, sectionEnd).replace(/\n+$/, '')
    const tail = body.slice(sectionEnd)
    return `${before}\n${entry}${tail ? `\n${tail}` : '\n'}`
  }
  return `${body}\n\n${heading}\n\n${entry}\n`
}

function mergeUserAnnotations(content: string, blocks: string[]): string {
  const body = content.replace(/^\n+/, '').replace(/\n+$/, '')
  const heading = '## 用户批注'
  const joined = blocks.join('\n\n')
  const match = USER_ANNOTATION_HEADING_RE.exec(body)
  if (!match) {
    return `${body}\n\n${heading}\n\n${joined}\n`
  }
  const headingStart = match.index
  // find next H2 after this heading
  const after = body.slice(headingStart + match[0].length)
  const nextH2 = /\n##\s+/.exec(after)
  const sectionEnd = nextH2 ? headingStart + match[0].length + nextH2.index : body.length
  const before = body.slice(0, sectionEnd).replace(/\n+$/, '')
  const tail = body.slice(sectionEnd)
  return `${before}\n\n${joined}${tail ? `\n${tail}` : '\n'}`
}

function renumberHeadings(body: string): string {
  let h2 = 0
  let h3 = 0
  return body.replace(
    /^(#{2,3})\s+(?:\d+(?:\.\d+)*\.?\s+)?(.+)$/gm,
    (_full, hashes: string, title: string) => {
      if (hashes === '##') {
        h2++
        h3 = 0
        return `## ${h2}. ${title.trim()}`
      }
      h3++
      return `### ${h2}.${h3} ${title.trim()}`
    },
  )
}

function serializeSpec(fm: SpecFrontmatter, body: string): string {
  const head = [
    '---',
    `stage: ${fm.stage}`,
    `last_action: ${fm.last_action}`,
    `updated_at: ${formatUpdatedAtForYaml(fm.updated_at)}`,
    `summary: ${fm.summary}`,
    '---',
    '',
  ].join('\n')
  const out = renumberHeadings(body)
  return `${head}${out.startsWith('\n') ? '' : '\n'}${out}${out.endsWith('\n') ? '' : '\n'}`
}

function formatUpdatedAtForYaml(value: string): string {
  // YAML 1.1 parses bare `YYYY-MM-DD HH:mm:ss` (or `YYYY-MM-DDTHH:mm:ss…`)
  // as timestamps and gray-matter then hands us a `Date`. Quote second-level
  // values so they round-trip as strings. Legacy `YYYY-MM-DD` is left bare for
  // diff stability — `dateString()` falls back to formatDate when re-reading.
  if (/[T :]/.test(value) && /:/.test(value)) return `'${value}'`
  return value
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
