import { createMemo, createSignal, onCleanup, type Accessor } from 'solid-js'
import { api, type AttachmentKind } from './api.js'
import { t } from '../i18n/index.js'

export const ACCEPT_MIME = 'image/*,application/pdf,text/plain,text/markdown,.md,.txt,.markdown'
export const MAX_FILE_SIZE = 5 * 1024 * 1024
export const MAX_COUNT = 10
const ALLOWED_MIMES = new Set(['application/pdf', 'text/plain', 'text/markdown'])

export interface DraftAttachment {
  id: string
  file: File
  name: string
  kind: AttachmentKind
  previewUrl?: string
  storedName?: string
  status: 'pending' | 'uploaded' | 'failed'
  error?: string
}

export function classifyFile(file: File): AttachmentKind | null {
  const mime = file.type
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'text/plain' || mime === 'text/markdown') return 'text'
  if (mime === '' && /\.(md|markdown|txt)$/i.test(file.name)) return 'text'
  return null
}

export function inferMimeIfMissing(file: File): File {
  if (file.type) return file
  if (/\.md$/i.test(file.name) || /\.markdown$/i.test(file.name)) {
    return new File([file], file.name, { type: 'text/markdown' })
  }
  if (/\.txt$/i.test(file.name)) {
    return new File([file], file.name, { type: 'text/plain' })
  }
  return file
}

export function stripExt(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return name
  return name.slice(0, idx)
}

function uid(): string {
  return Math.random().toString(36).slice(2, 8)
}

/**
 * Shared attachment controller for the draft-upload flow used by both NewSpec and
 * ChatPanel. Owns the draft id, the in-flight attachment list, upload/delete/rename
 * against the AttachmentStore, clipboard-image paste, and preview-URL lifecycle
 * (revoked on removal, reset, and unmount). Keeping this in one place is what stops
 * the two call sites from drifting apart.
 */
export interface AttachmentsController {
  attachments: Accessor<DraftAttachment[]>
  draftId: Accessor<string | null>
  error: Accessor<string | null>
  setError: (v: string | null) => void
  count: Accessor<number>
  hasPending: Accessor<boolean>
  hasFailed: Accessor<boolean>
  renamingId: Accessor<string | null>
  renameDraft: Accessor<string>
  setRenameDraft: (v: string) => void
  addFiles: (files: File[]) => Promise<void>
  onFileInputChange: (e: Event) => Promise<void>
  onPaste: (e: ClipboardEvent) => Promise<void>
  removeAttachment: (id: string) => Promise<void>
  beginRename: (att: DraftAttachment) => void
  commitRename: (att: DraftAttachment) => Promise<void>
  cancelRename: () => void
  /** Drop all attachments + draft id, revoking preview URLs. */
  reset: () => void
}

export function createAttachments(opts: {
  projectId: Accessor<string>
}): AttachmentsController {
  const [attachments, setAttachments] = createSignal<DraftAttachment[]>([])
  const [draftId, setDraftId] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal('')

  const count = createMemo(() => attachments().length)
  const hasPending = createMemo(() => attachments().some((a) => a.status === 'pending'))
  const hasFailed = createMemo(() => attachments().some((a) => a.status === 'failed'))

  onCleanup(() => {
    for (const att of attachments()) {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
    }
  })

  async function ensureDraftId(): Promise<string> {
    const existing = draftId()
    if (existing) return existing
    const { draftId: newId } = await api.createDraft(opts.projectId())
    setDraftId(newId)
    return newId
  }

  function pushAttachment(att: DraftAttachment) {
    setAttachments((prev) => [...prev, att])
  }

  function replaceAttachment(id: string, patch: Partial<DraftAttachment>) {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  function removeAttachmentLocal(id: string) {
    setAttachments((prev) => {
      const remaining: DraftAttachment[] = []
      for (const a of prev) {
        if (a.id === id) {
          if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
          continue
        }
        remaining.push(a)
      }
      return remaining
    })
  }

  async function addFiles(files: File[]) {
    setError(null)
    const current = attachments()
    const room = MAX_COUNT - current.length
    if (room <= 0) {
      setError(t('newSpec.attachmentLimit', { max: MAX_COUNT }))
      return
    }
    const accepted: DraftAttachment[] = []
    for (const rawFile of files.slice(0, room)) {
      const file = inferMimeIfMissing(rawFile)
      const kind = classifyFile(file)
      if (!kind) {
        setError(t('newSpec.unsupportedType', { name: file.name }))
        continue
      }
      if (kind !== 'image' && !ALLOWED_MIMES.has(file.type)) {
        setError(t('newSpec.unsupportedMime', { mime: file.type || '(unknown)' }))
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(t('newSpec.fileTooLarge', { name: file.name }))
        continue
      }
      const id = `att-${Date.now()}-${uid()}`
      const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined
      accepted.push({ id, file, name: file.name, kind, previewUrl, status: 'pending' })
    }
    if (accepted.length === 0) return
    if (files.length > room) {
      setError(t('newSpec.attachmentRoomLimit', { room, current: current.length, max: MAX_COUNT }))
    }
    for (const att of accepted) pushAttachment(att)
    try {
      const did = await ensureDraftId()
      for (const att of accepted) {
        try {
          const meta = await api.uploadAttachment(opts.projectId(), did, att.file)
          replaceAttachment(att.id, {
            storedName: meta.storedName,
            name: meta.storedName,
            status: 'uploaded',
          })
        } catch (err) {
          replaceAttachment(att.id, { status: 'failed', error: (err as Error).message })
        }
      }
    } catch (err) {
      setError((err as Error).message)
      for (const att of accepted) {
        replaceAttachment(att.id, { status: 'failed', error: (err as Error).message })
      }
    }
  }

  async function onFileInputChange(e: Event) {
    const target = e.currentTarget as HTMLInputElement
    if (!target.files) return
    const list = Array.from(target.files)
    target.value = ''
    await addFiles(list)
  }

  async function onPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    const imgs: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) imgs.push(f)
      }
    }
    if (imgs.length === 0) return
    e.preventDefault()
    await addFiles(imgs)
  }

  async function removeAttachment(id: string) {
    const att = attachments().find((a) => a.id === id)
    if (!att) return
    if (att.storedName && draftId()) {
      try {
        await api.deleteAttachment(opts.projectId(), draftId()!, att.storedName)
      } catch (err) {
        setError((err as Error).message)
      }
    }
    removeAttachmentLocal(id)
  }

  function beginRename(att: DraftAttachment) {
    setRenameDraft(stripExt(att.name))
    setRenamingId(att.id)
  }

  async function commitRename(att: DraftAttachment) {
    const next = renameDraft().trim()
    setRenamingId(null)
    if (!next || !att.storedName || !draftId()) return
    if (next === stripExt(att.name)) return
    try {
      const meta = await api.renameAttachment(opts.projectId(), draftId()!, att.storedName, next)
      replaceAttachment(att.id, { storedName: meta.storedName, name: meta.storedName })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function cancelRename() {
    setRenamingId(null)
  }

  function reset() {
    for (const att of attachments()) {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
    }
    setAttachments([])
    setDraftId(null)
    setRenamingId(null)
    setRenameDraft('')
    setError(null)
  }

  return {
    attachments,
    draftId,
    error,
    setError,
    count,
    hasPending,
    hasFailed,
    renamingId,
    renameDraft,
    setRenameDraft,
    addFiles,
    onFileInputChange,
    onPaste,
    removeAttachment,
    beginRename,
    commitRename,
    cancelRename,
    reset,
  }
}
