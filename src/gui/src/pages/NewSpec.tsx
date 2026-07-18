import { Show, createSignal, onCleanup, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { Upload, Loader2, Send } from 'lucide-solid'
import { api, type CreateSpecBody } from '../lib/api.js'
import { ACCEPT_MIME, MAX_COUNT, createAttachments } from '../lib/attachments.js'
import { projectHref, requestChatSession, useCurrentProjectId } from '../lib/project.js'
import { subscribeSpecsList, subscribeSession } from '../lib/sse.js'
import { Button } from '../components/ui/button.jsx'
import { MentionTextarea } from '../components/MentionTextarea.jsx'
import { AttachmentList } from '../components/AttachmentList.jsx'
import { Checkbox, CheckboxControl, CheckboxLabel } from '../components/ui/checkbox.jsx'
import { Breadcrumb } from '../components/Breadcrumb.jsx'
import { t } from '../i18n/index.js'

type Phase = 'idle' | 'creating' | 'failed'

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
  const [phase, setPhase] = createSignal<Phase>('idle')
  const [useWorktree, setUseWorktree] = createSignal(false)
  const busy = () => phase() === 'creating'

  const att = createAttachments({ projectId })
  const error = att.error
  const setError = att.setError

  let cleanupList: (() => void) | null = null
  let sessionUnsub: (() => void) | null = null
  let baselineIds: Set<string> = new Set()
  let targetProjectId: string = ''
  let navigated = false
  let fileInputEl: HTMLInputElement | undefined

  onCleanup(() => {
    cleanupList?.()
    sessionUnsub?.()
  })

  async function pollForNewSpec() {
    if (navigated) return
    const pid = targetProjectId || projectId()
    try {
      const list = await api.listSpecs(pid)
      const fresh = list.find((s) => !baselineIds.has(s.id))
      if (fresh) {
        navigated = true
        cleanupList?.()
        cleanupList = null
        sessionUnsub?.()
        sessionUnsub = null
        const target = pid
          ? `/${pid}/specs/${encodeURIComponent(fresh.id)}`
          : projectHref(`specs/${encodeURIComponent(fresh.id)}`)
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
    const failed = att.attachments().filter((a) => a.status === 'failed')
    if (failed.length > 0) {
      setError(t('newSpec.attachmentFailedCount', { count: failed.length }))
      return
    }
    if (att.hasPending()) {
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
      const did = att.draftId()
      if (did) body.draftId = did

      const resp = await api.createSpec(pid, body)
      if ('draft' in resp && resp.draft) {
        requestChatSession(resp.sessionId)
        sessionUnsub = subscribeSession(pid, resp.sessionId, {
          onEvent: (ev) => {
            if (ev.type === 'error') {
              setPhase('failed')
              setError(ev.message || t('newSpec.agentRunFailed'))
              sessionUnsub?.()
              sessionUnsub = null
            }
          },
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
    <section class="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <header class="flex flex-col gap-1">
        <Breadcrumb
          items={[
            { label: t('breadcrumb.specList'), href: projectHref('') },
            { label: t('breadcrumb.newSpec') },
          ]}
        />
      </header>
      <p class=" text-muted-foreground">{t('newSpec.description')}</p>

      <form class="flex flex-col gap-4 rounded-xl border bg-card p-4" onSubmit={submit}>
        <fieldset class="m-0 flex flex-wrap gap-2 border-0 p-0" disabled={busy()}>
          <legend class="mb-1.5 font-medium">{t('newSpec.type')}</legend>
          {TYPES.map((tp) => (
            <label
              class={`flex min-h-[44px] flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-lg border p-3 transition-colors ${
                type() === tp.value ? 'border-primary bg-primary/10' : 'border-border bg-background'
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
              <strong class=" ">{t(tp.labelKey)}</strong>
              <span class="text-sm text-muted-foreground">{t(tp.hintKey)}</span>
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
          <CheckboxLabel class="cursor-pointer font-medium">
            {t('newSpec.parallelWorktree')}
          </CheckboxLabel>
          <span class="text-sm text-muted-foreground">{t('newSpec.parallelWorktreeDesc')}</span>
        </Checkbox>

        <label class="flex flex-col gap-1.5 font-medium">
          <span>{t('newSpec.requirement')}</span>
          <MentionTextarea
            projectId={projectId()}
            value={content()}
            onValueChange={setContent}
            onPaste={att.onPaste}
            placeholder={t('newSpec.requirementPlaceholder')}
            autosize={false}
            rows={10}
            required
            autofocus
            disabled={busy()}
            class="resize-y"
          />
        </label>

        <section
          class="flex flex-col gap-2.5 rounded-lg border border-dashed bg-card p-3"
          onPaste={att.onPaste}
        >
          <div class="flex flex-wrap items-center gap-2.5">
            <span class="font-semibold">{t('newSpec.attachments')}</span>
            <span class="text-sm text-muted-foreground">
              {t('newSpec.attachmentsHint', { count: att.count(), max: MAX_COUNT })}
            </span>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => fileInputEl?.click()}
              disabled={busy() || att.count() >= MAX_COUNT}
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
              onChange={att.onFileInputChange}
            />
          </div>
          <Show when={att.count() > 0}>
            <AttachmentList ctrl={att} busy={busy()} allowRename />
          </Show>
        </section>

        {error() && <p class=" text-destructive">{error()}</p>}

        <Button type="submit" variant="default" disabled={busy()}>
          {busy() ? <Loader2 class="mr-1 h-4 w-4 animate-spin" /> : <Send class="mr-1 h-4 w-4" />}
          {busy() ? t('newSpec.creating') : t('newSpec.createAndStart')}
        </Button>

        {busy() && <p class=" text-muted-foreground">{t('newSpec.creatingHint')}</p>}
      </form>
    </section>
  )
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
