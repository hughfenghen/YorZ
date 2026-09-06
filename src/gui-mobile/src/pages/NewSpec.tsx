import { For, Show, createEffect, createSignal, on, onCleanup, type Component } from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { X } from 'lucide-solid'
import { api, type CreateSpecBody } from '@shared/api/index.js'
import { subscribeSession, subscribeSpecsList } from '@shared/api/sse.js'
import { ACCEPT_MIME, MAX_COUNT, createAttachments } from '@shared/lib/attachments.js'
import {
  clearDraft,
  createNewSpecPoller,
  persistDraft,
  readDraft,
  serializeDraft,
  type NewSpecDraft,
  type SpecType,
} from '@shared/lib/spec-draft.js'
import { Page } from '@/components/Page.jsx'
import { NoProjectNotice } from '@/components/ListStates.jsx'
import { showToast } from '@/components/Toast.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { attachmentLabels } from '@/lib/attachment-labels.js'
import { cn } from '@/lib/cn'
import { t } from '@/i18n/index.js'

const TYPES: { value: SpecType; labelKey: string; hintKey: string }[] = [
  { value: 'feat', labelKey: 'newSpec.typeFeat', hintKey: 'newSpec.typeFeatHint' },
  { value: 'refct', labelKey: 'newSpec.typeRefct', hintKey: 'newSpec.typeRefctHint' },
  { value: 'fix', labelKey: 'newSpec.typeFix', hintKey: 'newSpec.typeFixHint' },
]

const MIN_REQUIREMENT = 5

/**
 * 新建 spec。
 *
 * 与桌面端共用提交契约与本地草稿（`@shared/lib/spec-draft.js`，同一个 storage
 * key）——同一台机器上两端编辑同一个项目的草稿会互通，这是特性：手机上起个头、
 * 回到桌面接着写，是这条链路最自然的用法。
 *
 * 砍掉的是 worktree 选项：那是桌面端多分支并行开发的工作流，移动端的
 * active-project 是全局单选模型，没有承载物。
 */
export const NewSpec: Component = () => {
  const navigate = useNavigate()
  const pid = () => activeProjectId() ?? ''

  const [type, setType] = createSignal<SpecType>('feat')
  const [requirement, setRequirement] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const att = createAttachments({ projectId: pid, labels: attachmentLabels() })

  let cleanupList: (() => void) | null = null
  let sessionUnsub: (() => void) | null = null
  let restoring = false
  /** 提交时主动清掉的那一份快照：草稿 effect 看到它就跳过，避免刚清就被写回。 */
  let suppressedSnapshot = ''

  onCleanup(() => {
    cleanupList?.()
    sessionUnsub?.()
  })

  createEffect(
    on(pid, (p) => {
      restoring = true
      const draft = readDraft(p)
      setRequirement(draft.content ?? '')
      setType(draft.type ?? 'feat')
      restoring = false
    }),
  )

  createEffect(() => {
    if (restoring || busy()) return
    // useWorktree 恒 false：移动端没有这个开关，但共享的草稿结构要求这个字段，
    // 写死默认值才能让「与默认值一致 = 不算草稿」的判定在两端得出同样结论。
    const draft: NewSpecDraft = { content: requirement(), type: type(), useWorktree: false }
    const snapshot = serializeDraft(draft)
    if (snapshot === suppressedSnapshot) return
    suppressedSnapshot = ''
    persistDraft(pid(), draft)
  })

  const poller = createNewSpecPoller({
    listSpecs: () => api.listSpecs(pid()),
    onFound: (id) => {
      cleanupList?.()
      cleanupList = null
      sessionUnsub?.()
      sessionUnsub = null
      // replace：草稿表单已经消费掉了，返回键该回到列表而不是回到一张空表。
      navigate(`/specs/${encodeURIComponent(id)}`, { replace: true })
    },
  })

  async function submit(e: Event) {
    e.preventDefault()
    if (busy()) return
    setError(null)
    const text = requirement().trim()
    if (text.length < MIN_REQUIREMENT) {
      setError(t('newSpec.requirementTooShort'))
      return
    }
    if (att.attachments().some((a) => a.status === 'failed')) {
      setError(t('chat.attachFailed'))
      return
    }
    if (att.hasPending()) {
      setError(t('chat.attachUploading'))
      return
    }

    setBusy(true)
    try {
      const p = pid()
      suppressedSnapshot = serializeDraft({ content: text, type: type(), useWorktree: false })
      clearDraft(p)

      // baseline 必须在 create 之前取：agent 起草是 202 异步的，新 spec 的 id
      // 只能靠「相对这份快照多出来的那个」认出来。
      const before = await api.listSpecs(p)
      poller.setBaseline(before.map((s) => s.id))

      const body: CreateSpecBody = { type: type(), requirement: text }
      const did = att.draftId()
      if (did) body.draftId = did

      const resp = await api.createSpec(p, body)
      if ('draft' in resp && resp.draft) {
        showToast(t('newSpec.drafting'))
        sessionUnsub = subscribeSession(p, resp.sessionId, {
          onEvent: (ev) => {
            if (ev.type !== 'error') return
            setBusy(false)
            setError(ev.message || t('newSpec.createFailed'))
            sessionUnsub?.()
            sessionUnsub = null
          },
        })
        cleanupList = subscribeSpecsList(p, () => void poller.poll())
        // 订阅之前可能已经落过一次事件，先主动探一发。
        void poller.poll()
      } else if ('id' in resp) {
        navigate(`/specs/${encodeURIComponent(resp.id)}`, { replace: true })
      }
    } catch (err) {
      setError((err as Error).message || t('newSpec.createFailed'))
      setBusy(false)
    }
  }

  return (
    <Page title={t('newSpec.title')} onBack={() => navigate('/specs')}>
      <Show when={pid()} fallback={<NoProjectNotice />}>
        <form class="space-y-5" onSubmit={(e) => void submit(e)}>
          <fieldset>
            <legend class="mb-2 text-xs text-muted-foreground">{t('newSpec.type')}</legend>
            <div class="flex gap-2" role="radiogroup">
              <For each={TYPES}>
                {(item) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={type() === item.value}
                    class={cn(
                      'min-h-11 flex-1 rounded-lg border text-sm active:opacity-80',
                      type() === item.value
                        ? 'border-primary bg-primary/10 font-medium'
                        : 'border-border bg-background',
                    )}
                    onClick={() => setType(item.value)}
                  >
                    {t(item.labelKey)}
                  </button>
                )}
              </For>
            </div>
            <p class="mt-1.5 text-xs text-muted-foreground">
              {t(TYPES.find((x) => x.value === type())?.hintKey ?? 'newSpec.typeFeatHint')}
            </p>
          </fieldset>

          <label class="block">
            <span class="mb-1 block text-xs text-muted-foreground">{t('newSpec.requirement')}</span>
            <textarea
              rows={8}
              class="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
              placeholder={t('newSpec.requirementHint')}
              value={requirement()}
              onInput={(e) => setRequirement(e.currentTarget.value)}
            />
          </label>

          <fieldset>
            <legend class="mb-2 text-xs text-muted-foreground">{t('newSpec.attachments')}</legend>
            <div class="flex flex-wrap items-center gap-2">
              <For each={att.attachments()}>
                {(a) => (
                  <div class="relative">
                    <Show
                      when={a.previewUrl}
                      fallback={
                        <div class="flex h-16 w-24 items-center justify-center rounded border bg-muted px-1 text-[10px] text-muted-foreground">
                          <span class="truncate-start block w-full">{a.name}</span>
                        </div>
                      }
                    >
                      <img
                        src={a.previewUrl}
                        alt={a.name}
                        class="h-16 w-24 rounded border object-cover"
                      />
                    </Show>
                    <button
                      type="button"
                      class="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground"
                      aria-label={t('common.close')}
                      onClick={() => void att.removeAttachment(a.id)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </For>
              <Show when={att.count() < MAX_COUNT}>
                <label class="flex h-16 w-24 items-center justify-center rounded border border-dashed border-border text-xl text-muted-foreground active:bg-accent">
                  +
                  <input
                    type="file"
                    hidden
                    multiple
                    accept={ACCEPT_MIME}
                    onChange={(e) => void att.onFileInputChange(e)}
                  />
                </label>
              </Show>
            </div>
            <Show when={att.error()}>
              <p class="mt-1.5 text-xs text-destructive">{att.error()}</p>
            </Show>
          </fieldset>

          <Show when={error()}>
            <p class="text-sm text-destructive">{error()}</p>
          </Show>

          <button
            type="submit"
            class="flex min-h-12 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground active:opacity-80 disabled:opacity-40"
            disabled={busy()}
          >
            {busy() ? t('newSpec.creating') : t('newSpec.create')}
          </button>
        </form>
      </Show>
    </Page>
  )
}
