import { For, Show, createEffect, createSignal, onCleanup, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { X, Upload, Loader2 } from 'lucide-solid'
import { api, type AttachmentKind, type AttachmentMeta, type CreateSpecBody } from '../lib/api.js'
import { projectHref, useCurrentProjectId } from '../lib/project.js'
import { subscribeSpecsList } from '../lib/sse.js'
import { agentTasks } from '../lib/agent-tasks.js'
import { Button } from '../components/ui/button.jsx'
import { Textarea } from '../components/ui/textarea.jsx'
import { Input } from '../components/ui/input.jsx'
import { Checkbox, CheckboxControl, CheckboxLabel } from '../components/ui/checkbox.jsx'
import { t } from '../i18n/index.js'

const ACCEPT_MIME = 'image/*,application/pdf,text/plain,text/markdown,.md,.txt,.markdown'
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_COUNT = 10
const ALLOWED_MIMES = new Set(['application/pdf', 'text/plain', 'text/markdown'])

type Phase = 'idle' | 'creating' | 'failed'

interface DraftAttachment {
  id: string
  file: File
  name: string
  kind: AttachmentKind
  previewUrl?: string
  storedName?: string
  status: 'pending' | 'uploaded' | 'failed'
  error?: string
}

function classifyFile(file: File): AttachmentKind | null {
  const mime = file.type
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'text/plain' || mime === 'text/markdown') return 'text'
  if (mime === '' && /\.(md|markdown|txt)$/i.test(file.name)) return 'text'
  return null
}

function inferMimeIfMissing(file: File): File {
  if (file.type) return file
  if (/\.md$/i.test(file.name) || /\.markdown$/i.test(file.name)) {
    return new File([file], file.name, { type: 'text/markdown' })
  }
  if (/\.txt$/i.test(file.name)) {
    return new File([file], file.name, { type: 'text/plain' })
  }
  return file
}

function uid(): string {
  return Math.random().toString(36).slice(2, 8)
}

const TYPES: { value: CreateSpecBody['type']; labelKey: string; hintKey: string }[] = [
  { value: 'feat', labelKey: 'newSpec.typeFeat', hintKey: 'newSpec.typeFeatHint' },
  { value: 'refct', labelKey: 'newSpec.typeRefct', hintKey: 'newSpec.typeRefctHint' },
  { value: 'fix', labelKey: 'newSpec.typeFix', hintKey: 'newSpec.typeFixHint' },
]

export const NewSpec: Component = () => {
  const navigate = useNavigate()
  const projectId = useCurrentProjectId()
  const [content, setContent] = createSignal('')
  const [type, setType] = createSignal<CreateSpecBody['type']>('feat')
  const [error, setError] = createSignal<string | null>(null)
  const [phase, setPhase] = createSignal<Phase>('idle')
  const [attachments, setAttachments] = createSignal<DraftAttachment[]>([])
  const [draftId, setDraftId] = createSignal<string | null>(null)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal('')
  const [useWorktree, setUseWorktree] = createSignal(false)
  const busy = () => phase() === 'creating'

  const [mentionOpen, setMentionOpen] = createSignal(false)
  const [mentionItems, setMentionItems] = createSignal<string[]>([])
  const [mentionIndex, setMentionIndex] = createSignal(0)
  let mentionStart = -1
  let mentionQuery = ''
  let mentionTimer: ReturnType<typeof setTimeout> | null = null
  let itemRefs: (HTMLLIElement | null)[] = []

  let cleanupList: (() => void) | null = null
  let baselineIds: Set<string> = new Set()
  let targetProjectId: string = ''
  const [activeRunId, setActiveRunId] = createSignal<string | null>(null)
  let navigated = false
  let fileInputEl: HTMLInputElement | undefined
  let textareaEl: HTMLTextAreaElement | undefined

  onCleanup(() => {
    cleanupList?.()
    for (const att of attachments()) {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
    }
  })

  createEffect(() => {
    const rid = activeRunId()
    if (!rid) return
    const task = agentTasks.state.tasks[rid]
    if (!task) return
    if (task.status === 'failed') {
      setPhase('failed')
      setError(task.error ?? t('newSpec.agentRunFailed'))
      cleanupList?.()
      cleanupList = null
    }
  })

  async function ensureDraftId(): Promise<string> {
    const existing = draftId()
    if (existing) return existing
    const { draftId: newId } = await api.createDraft(projectId())
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
      accepted.push({
        id,
        file,
        name: file.name,
        kind,
        previewUrl,
        status: 'pending',
      })
    }
    if (accepted.length === 0) return
    if (files.length > room) {
      setError(
        t('newSpec.attachmentRoomLimit', { room, current: current.length, max: MAX_COUNT }),
      )
    }
    for (const att of accepted) pushAttachment(att)
    try {
      const did = await ensureDraftId()
      for (const att of accepted) {
        try {
          const meta = await api.uploadAttachment(projectId(), did, att.file)
          replaceAttachment(att.id, {
            storedName: meta.storedName,
            name: meta.storedName,
            status: 'uploaded',
          })
        } catch (err) {
          replaceAttachment(att.id, {
            status: 'failed',
            error: (err as Error).message,
          })
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

  function checkMention(el: HTMLTextAreaElement) {
    const pos = el.selectionStart
    const text = el.value.slice(0, pos)
    const atIdx = text.lastIndexOf('@')
    if (atIdx === -1) {
      closeMention()
      return
    }
    if (atIdx > 0 && !/\s/.test(text[atIdx - 1])) {
      closeMention()
      return
    }
    const afterAt = text.slice(atIdx + 1)
    if (!/^[\w./@-]*$/.test(afterAt)) {
      closeMention()
      return
    }
    mentionStart = atIdx
    mentionQuery = afterAt
    if (!mentionOpen()) setMentionOpen(true)
    debouncedSearch(afterAt)
  }

  function closeMention() {
    setMentionOpen(false)
    setMentionItems([])
    setMentionIndex(0)
    mentionStart = -1
    mentionQuery = ''
    itemRefs = []
    if (mentionTimer) {
      clearTimeout(mentionTimer)
      mentionTimer = null
    }
  }

  function debouncedSearch(query: string) {
    if (mentionTimer) clearTimeout(mentionTimer)
    mentionTimer = setTimeout(async () => {
      const pid = projectId()
      if (!pid) return
      try {
        const result = await api.listFiles(pid, query)
        itemRefs = []
        setMentionItems(result.items)
        setMentionIndex(0)
      } catch {
        setMentionItems([])
      }
    }, 150)
  }

  function selectMention(path: string) {
    const text = content()
    const before = text.slice(0, mentionStart)
    const after = text.slice(mentionStart + 1 + mentionQuery.length)
    const replacement = '@' + path
    const newText = before + replacement + after
    setContent(newText)
    closeMention()
    if (textareaEl) {
      const cursorPos = before.length + replacement.length
      requestAnimationFrame(() => {
        textareaEl!.focus()
        textareaEl!.setSelectionRange(cursorPos, cursorPos)
      })
    }
  }

  function scrollActiveIntoView() {
    const el = itemRefs[mentionIndex()]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }

  function onTextareaKeyDown(e: KeyboardEvent) {
    if (!mentionOpen()) return
    const items = mentionItems()
    if (items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex((i) => (i + 1) % items.length)
      requestAnimationFrame(scrollActiveIntoView)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex((i) => (i - 1 + items.length) % items.length)
      requestAnimationFrame(scrollActiveIntoView)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (e.key === 'Enter' && e.isComposing) return
      e.preventDefault()
      selectMention(items[mentionIndex()])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMention()
    }
  }

  async function removeAttachment(id: string) {
    const att = attachments().find((a) => a.id === id)
    if (!att) return
    if (att.storedName && draftId()) {
      try {
        await api.deleteAttachment(projectId(), draftId()!, att.storedName)
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
      const meta = await api.renameAttachment(projectId(), draftId()!, att.storedName, next)
      replaceAttachment(att.id, { storedName: meta.storedName, name: meta.storedName })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function pollForNewSpec() {
    if (navigated) return
    const pid = targetProjectId || projectId()
    try {
      const list = await api.listSpecs(pid)
      const fresh = list.find((s) => !baselineIds.has(s.id))
      if (fresh) {
        navigated = true
        const runId = activeRunId()
        cleanupList?.()
        cleanupList = null
        const base = pid
          ? `/${pid}/specs/${encodeURIComponent(fresh.id)}`
          : projectHref(`specs/${encodeURIComponent(fresh.id)}`)
        const target = base + (runId ? `?runId=${encodeURIComponent(runId)}` : '')
        navigate(target)
      }
    } catch {
      // ignore; will retry on next list-updated event
    }
  }

  async function submit(e: Event) {
    e.preventDefault()
    if (phase() === 'creating') return
    setError(null)
    const text = content().trim()
    if (text.length < 5) {
      setError(t('newSpec.descTooShort'))
      return
    }
    const failed = attachments().filter((a) => a.status === 'failed')
    if (failed.length > 0) {
      setError(t('newSpec.attachmentFailedCount', { count: failed.length }))
      return
    }
    const pending = attachments().filter((a) => a.status === 'pending')
    if (pending.length > 0) {
      setError(t('newSpec.attachmentUploading'))
      return
    }
    setPhase('creating')
    navigated = false
    try {
      const sourcePid = projectId()
      let pid = sourcePid
      if (useWorktree()) {
        const slug = deriveSlug(text)
        const wt = await api.createWorktree(sourcePid, { specSlug: slug })
        pid = wt.id
      }
      targetProjectId = pid
      const before = await api.listSpecs(pid)
      baselineIds = new Set(before.map((s) => s.id))

      const body: CreateSpecBody = { type: type(), requirement: text }
      const did = draftId()
      if (did) body.draftId = did

      const resp = await api.createSpec(pid, body)
      if ('draft' in resp && resp.draft) {
        setActiveRunId(resp.runId)
        agentTasks.start({
          runId: resp.runId,
          projectId: pid,
          mode: 'skill-run',
          specId: `__draft__-${resp.runId}`,
          specTitle: t('newSpec.creatingSpec'),
          source: 'draft',
        })
        cleanupList = subscribeSpecsList(pid, () => {
          void pollForNewSpec()
        })
        void pollForNewSpec()
      } else if ('id' in resp) {
        navigate(`/${pid}/specs/${encodeURIComponent(resp.id)}`)
      }
    } catch (err) {
      setError((err as Error).message)
      setPhase('failed')
    }
  }

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <header class="flex items-center justify-between">
        <h1 class="m-0 text-xl">{t('newSpec.title')}</h1>
      </header>
      <p class="text-sm text-muted-foreground">{t('newSpec.description')}</p>

      <form class="flex flex-col gap-4 rounded-xl border bg-card p-4" onSubmit={submit}>
        <fieldset
          class="m-0 flex flex-wrap gap-2 border-0 p-0"
          disabled={busy()}
        >
          <legend class="mb-1.5 font-medium">{t('newSpec.type')}</legend>
          {TYPES.map((tp) => (
            <label
              class={`flex min-h-[44px] flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-lg border p-3 transition-colors ${
                type() === tp.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background'
              }`}
            >
              <input
                type="radio"
                name="type"
                value={tp.value}
                checked={type() === tp.value}
                onChange={() => setType(tp.value)}
                disabled={busy()}
                class="hidden"
              />
              <strong class="text-sm">{t(tp.labelKey)}</strong>
              <span class="text-xs text-muted-foreground">{t(tp.hintKey)}</span>
            </label>
          ))}
        </fieldset>

        <Checkbox
          checked={useWorktree()}
          onChange={(v) => setUseWorktree(v)}
          disabled={busy()}
          class="flex flex-wrap items-center gap-2"
        >
          <CheckboxControl />
          <CheckboxLabel class="text-sm font-medium">
            {t('newSpec.parallelWorktree')}
          </CheckboxLabel>
          <span class="text-xs text-muted-foreground">
            {t('newSpec.parallelWorktreeDesc')}
          </span>
        </Checkbox>

        <label class="flex flex-col gap-1.5 font-medium">
          <span>{t('newSpec.requirement')}</span>
          <div class="relative w-full">
            <Textarea
              ref={textareaEl}
              rows={10}
              value={content()}
              onInput={(e) => {
                setContent(e.currentTarget.value)
                checkMention(e.currentTarget)
              }}
              onKeyDown={onTextareaKeyDown}
              onBlur={() => setTimeout(() => closeMention(), 150)}
              onPaste={onPaste}
              placeholder={t('newSpec.requirementPlaceholder')}
              required
              autofocus
              disabled={busy()}
              class="resize-y"
            />
            <Show when={mentionOpen() && mentionItems().length > 0}>
              <ul class="absolute bottom-full left-0 right-0 z-[100] m-0 max-h-60 list-none overflow-y-auto rounded-lg border bg-card py-1 shadow-lg">
                <For each={mentionItems()}>
                  {(item, i) => (
                    <li ref={(el) => (itemRefs[i()] = el)}>
                      <button
                        type="button"
                        class={`block w-full overflow-hidden whitespace-nowrap border-0 bg-transparent px-3 py-1.5 text-left text-sm text-ellipsis ${
                          mentionIndex() === i()
                            ? 'bg-primary text-primary-foreground'
                            : 'text-foreground'
                        }`}
                        onMouseEnter={() => setMentionIndex(i())}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectMention(item)
                        }}
                      >
                        {item}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </label>

        <section class="flex flex-col gap-2.5 rounded-lg border border-dashed bg-card p-3" onPaste={onPaste}>
          <div class="flex flex-wrap items-center gap-2.5">
            <span class="font-semibold">{t('newSpec.attachments')}</span>
            <span class="text-xs text-muted-foreground">
              {t('newSpec.attachmentsHint', { count: attachments().length, max: MAX_COUNT })}
            </span>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => fileInputEl?.click()}
              disabled={busy() || attachments().length >= MAX_COUNT}
            >
              <Upload class="mr-1 h-3.5 w-3.5" />
              {t('newSpec.importAttachment')}
            </Button>
            <input
              ref={fileInputEl}
              type="file"
              accept={ACCEPT_MIME}
              multiple
              hidden
              onChange={onFileInputChange}
            />
          </div>
          <Show when={attachments().length > 0}>
            <ul class="m-0 grid list-none gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
              <For each={attachments()}>
                {(att) => (
                  <li
                    class={`grid items-center gap-2 rounded-lg border bg-background p-2 [grid-template-columns:56px_1fr_auto] ${
                      att.status === 'pending' ? 'opacity-75' : ''
                    } ${att.status === 'failed' ? 'border-destructive' : ''}`}
                  >
                    <div class="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md bg-card">
                      <Show
                        when={att.kind === 'image' && att.previewUrl}
                        fallback={
                          <span class="rounded border border-border bg-background px-1 py-0.5 text-xs font-bold text-muted-foreground">
                            {att.kind === 'pdf' ? 'PDF' : 'TXT'}
                          </span>
                        }
                      >
                        <img
                          src={att.previewUrl}
                          alt={att.name}
                          class="h-full w-full object-cover"
                        />
                      </Show>
                    </div>
                    <div class="flex min-w-0 flex-col">
                      <Show
                        when={renamingId() === att.id}
                        fallback={
                          <button
                            type="button"
                            class="cursor-pointer overflow-hidden whitespace-nowrap border-0 bg-transparent p-0 text-left text-ellipsis hover:underline disabled:cursor-default"
                            onClick={() => beginRename(att)}
                            disabled={busy() || att.status !== 'uploaded'}
                            title={t('newSpec.clickToRename')}
                          >
                            {att.name}
                          </button>
                        }
                      >
                        <Input
                          type="text"
                          value={renameDraft()}
                          autofocus
                          onInput={(e) => setRenameDraft(e.currentTarget.value)}
                          onBlur={() => void commitRename(att)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void commitRename(att)
                            } else if (e.key === 'Escape') {
                              setRenamingId(null)
                            }
                          }}
                          class="h-7 py-0.5 text-xs"
                        />
                      </Show>
                      <span class="text-xs text-muted-foreground">
                        <Show when={att.status === 'pending'}>
                          <Loader2 class="mr-0.5 inline h-3 w-3 animate-spin" />
                          {t('newSpec.uploading')}
                        </Show>
                        <Show when={att.status === 'failed'}>
                          {t('newSpec.uploadFailed', { error: att.error })}
                        </Show>
                        <Show when={att.status === 'uploaded'}>
                          {Math.round(att.file.size / 1024)} KB · {att.kind}
                        </Show>
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="h-7 w-7"
                      onClick={() => void removeAttachment(att.id)}
                      disabled={busy()}
                      aria-label={t('newSpec.deleteAttachment', { name: att.name })}
                    >
                      <X class="h-3.5 w-3.5" />
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        {error() && <p class="text-sm text-destructive">{error()}</p>}

        <Button type="submit" variant="default" disabled={busy()}>
          {busy() ? t('newSpec.creating') : t('newSpec.createAndStart')}
        </Button>

        {busy() && (
          <p class="text-sm text-muted-foreground">{t('newSpec.creatingHint')}</p>
        )}
      </form>
    </section>
  )
}

function stripExt(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return name
  return name.slice(0, idx)
}

function deriveSlug(requirement: string): string {
  const firstLine = requirement.split(/\r?\n/)[0] ?? ''
  const ascii = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (ascii && !/^[0-9]+$/.test(ascii)) return ascii
  return `spec-${Date.now().toString(36)}`
}
