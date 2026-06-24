import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

export type AttachmentKind = 'image' | 'pdf' | 'text'

export interface AttachmentMeta {
  storedName: string
  name: string
  size: number
  mime: string
  kind: AttachmentKind
}

export interface AttachmentStoreOptions {
  cwd: string
  /** Override "now" for deterministic tests. */
  now?: () => number
  /** Single-file max in bytes (default 5 MB). */
  maxFileSize?: number
  /** Per-draft max count (default 10). */
  maxCount?: number
  /** Draft TTL in ms (default 24h). */
  ttlMs?: number
}

export class AttachmentStoreError extends Error {
  readonly code:
    | 'invalid_mime'
    | 'file_too_large'
    | 'too_many_attachments'
    | 'draft_not_found'
    | 'attachment_not_found'
    | 'invalid_name'
    | 'extension_changed'

  constructor(code: AttachmentStoreError['code'], message: string) {
    super(message)
    this.code = code
  }
}

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024
const DEFAULT_MAX_COUNT = 10
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
}

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
}

export function classifyMime(mime: string): AttachmentKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'text/plain' || mime === 'text/markdown') return 'text'
  return null
}

export function mimeForExt(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

export class AttachmentStore {
  private readonly root: string
  private readonly maxFileSize: number
  private readonly maxCount: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(opts: AttachmentStoreOptions) {
    this.root = join(opts.cwd, '.yorz', 'drafts')
    this.maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
    this.maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.now = opts.now ?? (() => Date.now())
  }

  get draftsDir(): string {
    return this.root
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  /** Generate a new draftId and create its attachments directory. */
  async createDraft(): Promise<string> {
    await this.ensureRoot()
    const draftId = randomUUID()
    await mkdir(this.draftAttachmentsDir(draftId), { recursive: true })
    return draftId
  }

  draftAttachmentsDir(draftId: string): string {
    return join(this.root, draftId, 'attachments')
  }

  draftDir(draftId: string): string {
    return join(this.root, draftId)
  }

  async draftExists(draftId: string): Promise<boolean> {
    return existsSync(this.draftDir(draftId))
  }

  /**
   * Store a file under the draft.
   * - Validates MIME / size.
   * - Validates per-draft count.
   * - Applies naming rules (image placeholder → image-<uuid:4>.<ext>; non-image → sanitize + suffix on collision).
   */
  async addAttachment(
    draftId: string,
    file: { name: string; mime: string; data: Uint8Array },
  ): Promise<AttachmentMeta> {
    const kind = classifyMime(file.mime)
    if (!kind) {
      throw new AttachmentStoreError('invalid_mime', `unsupported MIME: ${file.mime}`)
    }
    if (file.data.byteLength > this.maxFileSize) {
      throw new AttachmentStoreError(
        'file_too_large',
        `attachment exceeds ${this.maxFileSize} bytes`,
      )
    }
    const dir = this.draftAttachmentsDir(draftId)
    if (!existsSync(this.draftDir(draftId))) {
      throw new AttachmentStoreError('draft_not_found', `draft not found: ${draftId}`)
    }
    await mkdir(dir, { recursive: true })

    const existing = await this.listAttachmentNames(draftId)
    if (existing.length >= this.maxCount) {
      throw new AttachmentStoreError(
        'too_many_attachments',
        `draft already has ${existing.length} attachments (max ${this.maxCount})`,
      )
    }

    const storedName = this.allocateStoredName(file.name, file.mime, kind, existing)
    const target = join(dir, storedName)
    await writeFile(target, file.data)
    return {
      storedName,
      name: storedName,
      size: file.data.byteLength,
      mime: file.mime,
      kind,
    }
  }

  async deleteAttachment(draftId: string, storedName: string): Promise<void> {
    const file = this.resolveAttachmentPath(draftId, storedName)
    if (!existsSync(file)) {
      throw new AttachmentStoreError('attachment_not_found', `attachment not found: ${storedName}`)
    }
    await rm(file, { force: true })
  }

  async renameAttachment(
    draftId: string,
    storedName: string,
    newName: string,
  ): Promise<AttachmentMeta> {
    const file = this.resolveAttachmentPath(draftId, storedName)
    if (!existsSync(file)) {
      throw new AttachmentStoreError('attachment_not_found', `attachment not found: ${storedName}`)
    }
    const trimmed = newName.trim()
    if (!trimmed) {
      throw new AttachmentStoreError('invalid_name', 'new name required')
    }
    const oldExt = extname(storedName).toLowerCase()
    const newExt = extname(trimmed).toLowerCase()
    if (newExt && newExt !== oldExt) {
      throw new AttachmentStoreError(
        'extension_changed',
        `cannot change extension (${oldExt} → ${newExt})`,
      )
    }
    const base = sanitize(stripExt(trimmed)) || stripExt(storedName)
    const existing = (await this.listAttachmentNames(draftId)).filter((n) => n !== storedName)
    const finalName = uniquify(`${base}${oldExt}`, existing)
    if (finalName === storedName) {
      const stats = await stat(file)
      return {
        storedName,
        name: finalName,
        size: stats.size,
        mime: mimeForExt(oldExt),
        kind: classifyMime(mimeForExt(oldExt)) ?? 'text',
      }
    }
    const next = join(this.draftAttachmentsDir(draftId), finalName)
    await rename(file, next)
    const stats = await stat(next)
    const mime = mimeForExt(oldExt)
    return {
      storedName: finalName,
      name: finalName,
      size: stats.size,
      mime,
      kind: classifyMime(mime) ?? 'text',
    }
  }

  async listAttachments(draftId: string): Promise<AttachmentMeta[]> {
    const dir = this.draftAttachmentsDir(draftId)
    if (!existsSync(dir)) return []
    const names = await this.listAttachmentNames(draftId)
    const out: AttachmentMeta[] = []
    for (const name of names) {
      const stats = await stat(join(dir, name))
      const ext = extname(name).toLowerCase()
      const mime = mimeForExt(ext)
      const kind = classifyMime(mime)
      if (!kind) continue
      out.push({ storedName: name, name, size: stats.size, mime, kind })
    }
    return out.sort((a, b) => (a.storedName < b.storedName ? -1 : 1))
  }

  async readAttachment(
    draftId: string,
    storedName: string,
  ): Promise<{ data: Buffer; mime: string; kind: AttachmentKind }> {
    const file = this.resolveAttachmentPath(draftId, storedName)
    if (!existsSync(file)) {
      throw new AttachmentStoreError('attachment_not_found', `attachment not found: ${storedName}`)
    }
    const data = await readFile(file)
    const ext = extname(storedName).toLowerCase()
    const mime = mimeForExt(ext)
    const kind = classifyMime(mime)
    if (!kind) {
      throw new AttachmentStoreError('attachment_not_found', `not a recognized attachment`)
    }
    return { data, mime, kind }
  }

  /** Remove draft dirs older than ttl. Best-effort. */
  async cleanupExpired(): Promise<{ removed: string[] }> {
    if (!existsSync(this.root)) return { removed: [] }
    const removed: string[] = []
    let entries
    try {
      entries = await readdir(this.root, { withFileTypes: true })
    } catch {
      return { removed }
    }
    const cutoff = this.now() - this.ttlMs
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(this.root, entry.name)
      try {
        const stats = await stat(dir)
        if (stats.mtimeMs <= cutoff) {
          await rm(dir, { recursive: true, force: true })
          removed.push(entry.name)
        }
      } catch {
        // ignore — best-effort
      }
    }
    return { removed }
  }

  private resolveAttachmentPath(draftId: string, storedName: string): string {
    if (!isSafeName(storedName)) {
      throw new AttachmentStoreError('invalid_name', `invalid attachment name: ${storedName}`)
    }
    return join(this.draftAttachmentsDir(draftId), storedName)
  }

  private async listAttachmentNames(draftId: string): Promise<string[]> {
    const dir = this.draftAttachmentsDir(draftId)
    if (!existsSync(dir)) return []
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name)
  }

  private allocateStoredName(
    rawName: string,
    mime: string,
    kind: AttachmentKind,
    existing: string[],
  ): string {
    const ext = pickExt(rawName, mime)
    if (kind === 'image' && isPlaceholderImageName(rawName)) {
      const short = randomUUID().slice(0, 4)
      const candidate = `image-${short}${ext}`
      return uniquify(candidate, existing)
    }
    const baseRaw = stripExt(rawName) || 'attachment'
    const sanitized = sanitize(baseRaw) || 'attachment'
    return uniquify(`${sanitized}${ext}`, existing)
  }
}

function isPlaceholderImageName(name: string): boolean {
  const lower = name.toLowerCase().trim()
  if (!lower) return true
  // Common browser placeholder names from clipboard / screenshot tools.
  return (
    lower === 'image.png' ||
    lower === 'image.jpg' ||
    lower === 'image.jpeg' ||
    lower === 'image.webp' ||
    lower === 'image.gif' ||
    /^(image|screenshot|clipboard)([._ -]?\d+)?\.[a-z0-9]+$/.test(lower) ||
    /^untitled\.[a-z0-9]+$/.test(lower)
  )
}

function pickExt(rawName: string, mime: string): string {
  const fromName = extname(rawName).toLowerCase()
  if (fromName) return fromName
  return MIME_TO_EXT[mime] ?? ''
}

function stripExt(name: string): string {
  const ext = extname(name)
  return ext ? name.slice(0, name.length - ext.length) : name
}

function sanitize(text: string): string {
  // Replace whitespace, path separators, ASCII control chars, and stray dots
  // with '-'. Keep CJK / accented letters; collapse leading/trailing dashes.
  // eslint-disable-next-line no-control-regex
  let cleaned = text.replace(/[\s\\/:*?"<>|\x00-\x1f]+/g, '-')
  cleaned = cleaned.replace(/\.+/g, '-')
  return cleaned.replace(/^-+|-+$/g, '').slice(0, 64)
}

function uniquify(name: string, existing: string[]): string {
  if (!existing.includes(name)) return name
  const ext = extname(name)
  const base = stripExt(name)
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}${ext}`
    if (!existing.includes(candidate)) return candidate
  }
  // Extreme fallback.
  return `${base}-${randomUUID().slice(0, 4)}${ext}`
}

function isSafeName(name: string): boolean {
  if (!name) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name === '.' || name === '..') return false
  if (name.startsWith('.')) return false
  return true
}
