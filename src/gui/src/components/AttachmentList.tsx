import { For, Show, createSignal, type Component } from 'solid-js'
import { X, Loader2 } from 'lucide-solid'
import { t } from '../i18n/index.js'
import { Button } from './ui/button.jsx'
import { Input } from './ui/input.jsx'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.jsx'
import { ImagePreview } from './ImagePreview.jsx'
import type { AttachmentsController, DraftAttachment } from '../lib/attachments.js'

/** One-line summary used as the hover tooltip in compact mode. */
function infoText(att: DraftAttachment): string {
  if (att.status === 'pending') return `${att.name} · ${t('newSpec.uploading')}`
  if (att.status === 'failed') return `${att.name} · ${t('newSpec.uploadFailed', { error: att.error })}`
  return `${att.name} · ${Math.round(att.file.size / 1024)} KB · ${att.kind}`
}

/**
 * Thumbnail list for draft attachments, shared by NewSpec and ChatPanel. Reads
 * from the {@link AttachmentsController}.
 * - `allowRename` gates the click-to-rename affordance (only NewSpec).
 * - `compact` renders a dense thumbnail-only strip (name/size/kind move into a
 *   hover tooltip); ChatPanel uses this to sit above its input box.
 */
export const AttachmentList: Component<{
  ctrl: AttachmentsController
  busy?: boolean
  allowRename?: boolean
  compact?: boolean
}> = (props) => {
  const ctrl = props.ctrl
  const [previewSrc, setPreviewSrc] = createSignal<string | undefined>()
  const [previewAlt, setPreviewAlt] = createSignal<string | undefined>()
  const [previewOpen, setPreviewOpen] = createSignal(false)

  function openPreview(att: DraftAttachment) {
    if (att.kind !== 'image' || !att.previewUrl) return
    setPreviewSrc(att.previewUrl)
    setPreviewAlt(att.name)
    setPreviewOpen(true)
  }

  return (
    <Show when={props.compact} fallback={<FullList {...props} />}>
      <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
        <For each={ctrl.attachments()}>
          {(att: DraftAttachment) => (
            <li class="group relative shrink-0">
              <Tooltip openDelay={150} closeDelay={0}>
                <TooltipTrigger
                  type="button"
                  class={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-card ${
                    att.status === 'pending' ? 'opacity-75' : ''
                  } ${att.status === 'failed' ? 'border-destructive' : ''} ${
                    att.kind === 'image' && att.previewUrl ? 'cursor-zoom-in' : 'cursor-default'
                  }`}
                  onClick={() => openPreview(att)}
                >
                  <Show
                    when={att.kind === 'image' && att.previewUrl}
                    fallback={
                      <span class="text-xs font-bold text-muted-foreground">
                        {att.kind === 'pdf' ? 'PDF' : 'TXT'}
                      </span>
                    }
                  >
                    <img src={att.previewUrl} alt={att.name} class="h-full w-full object-cover" />
                  </Show>
                  <Show when={att.status === 'pending'}>
                    <div class="absolute inset-0 flex items-center justify-center bg-background/50">
                      <Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  </Show>
                </TooltipTrigger>
                <TooltipContent>{infoText(att)}</TooltipContent>
              </Tooltip>
              <button
                type="button"
                class="absolute right-0 top-0 z-10 flex h-4 w-4 items-center justify-center rounded-bl bg-background/80 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 disabled:opacity-0"
                onClick={() => void ctrl.removeAttachment(att.id)}
                disabled={props.busy}
                aria-label={t('newSpec.deleteAttachment', { name: att.name })}
              >
                <X class="h-3 w-3" />
              </button>
            </li>
          )}
        </For>
      </ul>
      <ImagePreview
        src={previewSrc()}
        alt={previewAlt()}
        open={previewOpen()}
        onOpenChange={setPreviewOpen}
      />
    </Show>
  )
}

/** The original detailed layout (thumbnail + name/size/kind + rename + delete). */
const FullList: Component<{
  ctrl: AttachmentsController
  busy?: boolean
  allowRename?: boolean
}> = (props) => {
  const ctrl = props.ctrl
  return (
    <ul class="m-0 grid list-none gap-2 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
      <For each={ctrl.attachments()}>
        {(att: DraftAttachment) => (
          <li
            class={`grid items-center gap-2 rounded-lg border bg-background p-2 [grid-template-columns:56px_1fr_auto] ${
              att.status === 'pending' ? 'opacity-75' : ''
            } ${att.status === 'failed' ? 'border-destructive' : ''}`}
          >
            <div class="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md bg-card">
              <Show
                when={att.kind === 'image' && att.previewUrl}
                fallback={
                  <span class="rounded border border-border bg-background px-1 py-0.5 text-sm font-bold text-muted-foreground">
                    {att.kind === 'pdf' ? 'PDF' : 'TXT'}
                  </span>
                }
              >
                <img src={att.previewUrl} alt={att.name} class="h-full w-full object-cover" />
              </Show>
            </div>
            <div class="flex min-w-0 flex-col">
              <Show
                when={props.allowRename && ctrl.renamingId() === att.id}
                fallback={
                  <button
                    type="button"
                    class="cursor-pointer overflow-hidden whitespace-nowrap border-0 bg-transparent p-0 text-left text-ellipsis hover:underline disabled:cursor-default disabled:no-underline"
                    onClick={() => props.allowRename && ctrl.beginRename(att)}
                    disabled={props.busy || !props.allowRename || att.status !== 'uploaded'}
                    title={props.allowRename ? t('newSpec.clickToRename') : att.name}
                  >
                    {att.name}
                  </button>
                }
              >
                <Input
                  type="text"
                  value={ctrl.renameDraft()}
                  autofocus
                  onInput={(e) => ctrl.setRenameDraft(e.currentTarget.value)}
                  onBlur={() => void ctrl.commitRename(att)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void ctrl.commitRename(att)
                    } else if (e.key === 'Escape') {
                      ctrl.cancelRename()
                    }
                  }}
                  class="h-7 py-0.5 text-sm"
                />
              </Show>
              <span class="text-sm text-muted-foreground">
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
              onClick={() => void ctrl.removeAttachment(att.id)}
              disabled={props.busy}
              aria-label={t('newSpec.deleteAttachment', { name: att.name })}
            >
              <X class="h-3.5 w-3.5" />
            </Button>
          </li>
        )}
      </For>
    </ul>
  )
}
