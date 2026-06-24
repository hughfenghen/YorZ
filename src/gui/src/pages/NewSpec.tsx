import { For, Show, createSignal, onCleanup, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { api, type AttachmentKind, type AttachmentMeta, type CreateSpecBody } from '../lib/api.js'
import { subscribeSpecsList } from '../lib/sse.js'
import { agentTasks } from '../lib/agent-tasks.js'

const TYPES: { value: CreateSpecBody['type']; label: string; hint: string }[] = [
  { value: 'feat', label: 'feat', hint: '新功能' },
  { value: 'refct', label: 'refct', hint: '重构 / 抽取' },
  { value: 'fix', label: 'fix', hint: '修复缺陷' },
]

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

export const NewSpec: Component = () => {
  const navigate = useNavigate()
  const [content, setContent] = createSignal('')
  const [type, setType] = createSignal<CreateSpecBody['type']>('feat')
  const [error, setError] = createSignal<string | null>(null)
  const [phase, setPhase] = createSignal<Phase>('idle')
  const [attachments, setAttachments] = createSignal<DraftAttachment[]>([])
  const [draftId, setDraftId] = createSignal<string | null>(null)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)
  const [renameDraft, setRenameDraft] = createSignal('')
  const busy = () => phase() === 'creating'

  let cleanupList: (() => void) | null = null
  let baselineIds: Set<string> = new Set()
  let activeRunId: string | null = null
  let navigated = false
  let fileInputEl: HTMLInputElement | undefined

  onCleanup(() => {
    cleanupList?.()
    for (const att of attachments()) {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
    }
  })

  async function ensureDraftId(): Promise<string> {
    const existing = draftId()
    if (existing) return existing
    const { draftId: newId } = await api.createDraft()
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
      setError(`附件总数不能超过 ${MAX_COUNT} 个`)
      return
    }
    const accepted: DraftAttachment[] = []
    for (const rawFile of files.slice(0, room)) {
      const file = inferMimeIfMissing(rawFile)
      const kind = classifyFile(file)
      if (!kind) {
        setError(`不支持的文件类型：${file.name}`)
        continue
      }
      if (kind !== 'image' && !ALLOWED_MIMES.has(file.type)) {
        setError(`不支持的 MIME：${file.type || '(未知)'}`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name} 超过 5 MB 限制`)
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
      setError(`只能再添加 ${room} 个附件（当前 ${current.length}/${MAX_COUNT}）`)
    }
    for (const att of accepted) pushAttachment(att)
    try {
      const did = await ensureDraftId()
      for (const att of accepted) {
        try {
          const meta = await api.uploadAttachment(did, att.file)
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
        if (f) {
          // Some browsers name the pasted file "image.png"; keep that — backend rewrites placeholders.
          imgs.push(f)
        }
      }
    }
    if (imgs.length === 0) return
    // We intentionally do NOT preventDefault on non-image content, so text paste still flows into textarea.
    e.preventDefault()
    await addFiles(imgs)
  }

  async function removeAttachment(id: string) {
    const att = attachments().find((a) => a.id === id)
    if (!att) return
    if (att.storedName && draftId()) {
      try {
        await api.deleteAttachment(draftId()!, att.storedName)
      } catch (err) {
        setError((err as Error).message)
        // Even on backend failure, remove from UI so the user is not stuck.
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
      const meta = await api.renameAttachment(draftId()!, att.storedName, next)
      replaceAttachment(att.id, { storedName: meta.storedName, name: meta.storedName })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function pollForNewSpec() {
    if (navigated) return
    try {
      const list = await api.listSpecs()
      const fresh = list.find((s) => !baselineIds.has(s.id))
      if (fresh) {
        navigated = true
        const runId = activeRunId
        cleanupList?.()
        cleanupList = null
        const target =
          `/specs/${encodeURIComponent(fresh.id)}` +
          (runId ? `?runId=${encodeURIComponent(runId)}` : '')
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
      setError('请至少输入 5 个字符的需求描述')
      return
    }
    const failed = attachments().filter((a) => a.status === 'failed')
    if (failed.length > 0) {
      setError(`有 ${failed.length} 个附件上传失败，请先移除或重试`)
      return
    }
    const pending = attachments().filter((a) => a.status === 'pending')
    if (pending.length > 0) {
      setError('附件仍在上传中，请稍候')
      return
    }
    setPhase('creating')
    navigated = false
    try {
      const before = await api.listSpecs()
      baselineIds = new Set(before.map((s) => s.id))

      const body: CreateSpecBody = { type: type(), requirement: text }
      const did = draftId()
      if (did) body.draftId = did

      const resp = await api.createSpec(body)
      if ('draft' in resp && resp.draft) {
        activeRunId = resp.runId
        agentTasks.start({
          runId: resp.runId,
          mode: 'skill-run',
          specId: `__draft__-${resp.runId}`,
          specTitle: '（新建 spec 中）',
          source: 'draft',
        })
        cleanupList = subscribeSpecsList(() => {
          void pollForNewSpec()
        })
        void pollForNewSpec()
      } else if ('id' in resp) {
        navigate(`/specs/${encodeURIComponent(resp.id)}`)
      }
    } catch (err) {
      setError((err as Error).message)
      setPhase('failed')
    }
  }

  return (
    <section class="page">
      <header class="page-head">
        <h1>新建 spec</h1>
        <p class="muted">
          只需选择类型与录入需求内容；文件名、概要、初始骨架由 Agent 根据需求生成，Agent
          创建完文档后会自动进入 plan 阶段。
        </p>
      </header>
      <form class="form" onSubmit={submit}>
        <fieldset class="type-group" disabled={busy()}>
          <legend>类型</legend>
          {TYPES.map((t) => (
            <label class={`type-pill ${type() === t.value ? 'active' : ''}`}>
              <input
                type="radio"
                name="type"
                value={t.value}
                checked={type() === t.value}
                onChange={() => setType(t.value)}
                disabled={busy()}
              />
              <strong>{t.label}</strong>
              <span class="muted">{t.hint}</span>
            </label>
          ))}
        </fieldset>
        <label>
          <span>需求内容</span>
          <textarea
            rows={10}
            value={content()}
            onInput={(e) => setContent(e.currentTarget.value)}
            onPaste={onPaste}
            placeholder="原始诉求、痛点、期望效果、关联文档/模块（可使用 @ 引用）"
            required
            autofocus
            disabled={busy()}
          />
        </label>
        <section class="attachments" onPaste={onPaste}>
          <div class="attachments-head">
            <span class="attachments-title">附件</span>
            <span class="muted">
              共 {attachments().length}/{MAX_COUNT}，单文件 ≤ 5 MB；图片支持 Cmd/Ctrl-V 粘贴
            </span>
            <button
              type="button"
              class="ghost"
              onClick={() => fileInputEl?.click()}
              disabled={busy() || attachments().length >= MAX_COUNT}
            >
              导入附件
            </button>
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
            <ul class="attachment-list">
              <For each={attachments()}>
                {(att) => (
                  <li class={`attachment-item kind-${att.kind} status-${att.status}`}>
                    <div class="attachment-thumb">
                      <Show
                        when={att.kind === 'image' && att.previewUrl}
                        fallback={
                          <span class="attachment-icon" aria-hidden="true">
                            {att.kind === 'pdf' ? 'PDF' : 'TXT'}
                          </span>
                        }
                      >
                        <img src={att.previewUrl} alt={att.name} />
                      </Show>
                    </div>
                    <div class="attachment-meta">
                      <Show
                        when={renamingId() === att.id}
                        fallback={
                          <button
                            type="button"
                            class="attachment-name"
                            onClick={() => beginRename(att)}
                            disabled={busy() || att.status !== 'uploaded'}
                            title="点击重命名"
                          >
                            {att.name}
                          </button>
                        }
                      >
                        <input
                          type="text"
                          class="attachment-rename"
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
                        />
                      </Show>
                      <span class="attachment-status muted">
                        <Show when={att.status === 'pending'}>上传中…</Show>
                        <Show when={att.status === 'failed'}>失败：{att.error}</Show>
                        <Show when={att.status === 'uploaded'}>
                          {Math.round(att.file.size / 1024)} KB · {att.kind}
                        </Show>
                      </span>
                    </div>
                    <button
                      type="button"
                      class="attachment-remove ghost"
                      onClick={() => void removeAttachment(att.id)}
                      disabled={busy()}
                      aria-label={`删除 ${att.name}`}
                    >
                      ×
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
        {error() && <p class="error">{error()}</p>}
        <button type="submit" class="primary-action" disabled={busy()}>
          {busy() ? 'Agent 创建中…' : '创建并启动 Agent'}
        </button>
        {busy() && (
          <p class="muted">
            Agent 正在创建 spec 文档…可在右下角 Agent 面板查看流式输出，文档落地后将自动跳转。
          </p>
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
