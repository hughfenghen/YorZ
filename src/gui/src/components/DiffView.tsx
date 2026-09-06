import { For, Show, createMemo, type Component } from 'solid-js'
import { X } from 'lucide-solid'
import { diffLanguage, highlightLine, parsePatchRows } from '@shared/lib/diff-view.js'
import { t } from '../i18n/index.js'

export interface DiffViewProps {
  path: string
  patch: string
  binary: boolean
  truncated: boolean
  loading?: boolean
  error?: string | null
  onClose?: () => void
}

/*
 * Unified (single-column) diff renderer. The row model and highlighting come
 * from `@shared/lib/diff-view`; the painting is ours so the colours come from
 * the app's semantic tokens and follow every theme, which a drop-in HTML+CSS
 * diff renderer cannot.
 */
export const DiffView: Component<DiffViewProps> = (props) => {
  const files = createMemo(() => parsePatchRows(props.patch))
  const hasContent = createMemo(() => files().some((f) => f.chunks.length > 0))
  const language = createMemo(() => diffLanguage(props.path))

  return (
    <div
      data-testid="git-diff-pane"
      /* `code-highlight` puts this subtree in scope of the hljs token palette
         in app.css (previously reachable only under `.markdown`). */
      class="code-highlight flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <div class="flex items-center gap-2 border-b px-2 py-1">
        <span class="min-w-0 flex-1 truncate font-mono text-sm" title={props.path}>
          {props.path}
        </span>
        <Show when={props.truncated}>
          <span class="shrink-0 text-sm text-warning">{t('git.diffTruncated')}</span>
        </Show>
        <Show when={props.onClose}>
          <button
            type="button"
            class="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ring"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={() => props.onClose?.()}
          >
            <X class="h-4 w-4" />
          </button>
        </Show>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <Show
          when={!props.loading}
          fallback={<p class="p-3 text-muted-foreground">{t('git.diffLoading')}</p>}
        >
          <Show when={!props.error} fallback={<p class="p-3 text-destructive">{props.error}</p>}>
            <Show
              when={!props.binary}
              fallback={<p class="p-3 text-muted-foreground">{t('git.binaryFile')}</p>}
            >
              <Show
                when={hasContent()}
                fallback={<p class="p-3 text-muted-foreground">{t('git.diffEmpty')}</p>}
              >
                <For each={files()}>
                  {(file) => (
                    <For each={file.chunks}>
                      {(chunk) => (
                        <div>
                          <div class="bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground">
                            {chunk.header}
                          </div>
                          <For each={chunk.rows}>
                            {(row) => {
                              // Add/delete reads from the row tint plus the
                              // marker glyph; the code itself keeps its syntax
                              // colours instead of being flattened to one hue.
                              const tone =
                                row.tone === 'add'
                                  ? 'bg-success/10'
                                  : row.tone === 'del'
                                    ? 'bg-destructive/10'
                                    : ''
                              const markerTone =
                                row.tone === 'add'
                                  ? 'text-success'
                                  : row.tone === 'del'
                                    ? 'text-destructive'
                                    : 'text-muted-foreground'
                              const highlighted = highlightLine(row.code, language())
                              return (
                                <div class={`flex font-mono text-sm ${tone}`}>
                                  <span class="w-12 shrink-0 select-none px-1 text-right text-muted-foreground">
                                    {row.oldLn}
                                  </span>
                                  <span class="w-12 shrink-0 select-none px-1 text-right text-muted-foreground">
                                    {row.newLn}
                                  </span>
                                  <pre class="m-0 flex-1 whitespace-pre-wrap break-all px-2">
                                    <span class={`select-none ${markerTone}`}>{row.marker}</span>
                                    <Show when={highlighted} fallback={<span>{row.code}</span>}>
                                      {(html) => <span class="hljs" innerHTML={html()} />}
                                    </Show>
                                  </pre>
                                </div>
                              )
                            }}
                          </For>
                        </div>
                      )}
                    </For>
                  )}
                </For>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
