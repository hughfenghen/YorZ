import { For, Show, createMemo, type Component } from 'solid-js'
import { X } from 'lucide-solid'
import { diffLanguage, highlightLine, parsePatchRows } from '@shared/lib/diff-view.js'
import { t } from '@/i18n/index.js'

interface GitDiffViewProps {
  path: string
  patch: string
  binary: boolean
  truncated: boolean
  loading: boolean
  error: string | null
  onClose: () => void
}

/** Mobile unified diff pane shared by working-tree and commit-history views. */
export const GitDiffView: Component<GitDiffViewProps> = (props) => (
  <div class="code-highlight scroll-y min-h-0 flex-1 border-t border-border">
    <div class="sticky top-0 flex items-center gap-2 border-b border-border bg-card px-4 py-1.5">
      <span class="truncate-start min-w-0 flex-1 font-mono text-xs">{props.path}</span>
      <Show when={props.truncated}>
        <span class="shrink-0 text-xs text-warning">{t('git.diffTruncated')}</span>
      </Show>
      <button
        type="button"
        class="tap-target -mr-1 flex shrink-0 items-center justify-center text-muted-foreground active:opacity-60"
        aria-label={t('common.close')}
        onClick={() => props.onClose()}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
    <DiffBody
      path={props.path}
      patch={props.patch}
      binary={props.binary}
      loading={props.loading}
      error={props.error}
    />
  </div>
)

const DiffBody: Component<{
  path: string
  patch: string
  binary: boolean
  loading: boolean
  error: string | null
}> = (props) => {
  const files = createMemo(() => parsePatchRows(props.patch))
  const hasContent = createMemo(() => files().some((file) => file.chunks.length > 0))
  const language = createMemo(() => diffLanguage(props.path))

  return (
    <Show
      when={!props.loading}
      fallback={<p class="p-4 text-sm text-muted-foreground">{t('git.diffLoading')}</p>}
    >
      <Show
        when={!props.error}
        fallback={<p class="p-4 text-sm text-destructive">{props.error}</p>}
      >
        <Show
          when={!props.binary}
          fallback={<p class="p-4 text-sm text-muted-foreground">{t('git.binaryFile')}</p>}
        >
          <Show
            when={hasContent()}
            fallback={<p class="p-4 text-sm text-muted-foreground">{t('git.diffEmpty')}</p>}
          >
            <For each={files()}>
              {(file) => (
                <For each={file.chunks}>
                  {(chunk) => (
                    <div>
                      <div class="bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {chunk.header}
                      </div>
                      <For each={chunk.rows}>
                        {(row) => {
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
                            <div class={`flex font-mono text-[11px] leading-snug ${tone}`}>
                              <span class="w-9 shrink-0 select-none px-1 text-right text-muted-foreground">
                                {row.oldLn}
                              </span>
                              <span class="w-9 shrink-0 select-none px-1 text-right text-muted-foreground">
                                {row.newLn}
                              </span>
                              <pre class="m-0 min-w-0 flex-1 whitespace-pre-wrap break-all px-1">
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
  )
}
