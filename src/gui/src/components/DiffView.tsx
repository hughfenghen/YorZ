import { For, Show, createMemo, type Component } from 'solid-js'
import parseDiff from 'parse-diff'
import hljs from 'highlight.js/lib/common'
import { t } from '../i18n/index.js'

/*
 * File extension → highlight.js language. `highlight.js/lib/common` (the bundle
 * the markdown renderer already pulls in) only ships the common grammars, so
 * every hit is re-checked with getLanguage() and unknown types fall back to
 * plain text instead of throwing.
 */
const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  vue: 'xml',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
}

export interface DiffViewProps {
  path: string
  patch: string
  binary: boolean
  truncated: boolean
  loading?: boolean
  error?: string | null
}

/*
 * Unified (single-column) diff renderer. `parse-diff` only turns the patch text
 * into hunks; the painting is ours so the colours come from the app's semantic
 * tokens and follow every theme, which a drop-in HTML+CSS diff renderer cannot.
 */
export const DiffView: Component<DiffViewProps> = (props) => {
  const files = createMemo(() => (props.patch ? parseDiff(props.patch) : []))
  const hasContent = createMemo(() => files().some((f) => f.chunks.length > 0))

  const language = createMemo(() => {
    const ext = props.path.split('.').pop()?.toLowerCase() ?? ''
    const name = EXT_LANGUAGE[ext]
    return name && hljs.getLanguage(name) ? name : null
  })

  /*
   * Highlighted per line, not per hunk: a diff line is the unit we render, and
   * splitting hljs' nested markup back apart at newlines would mean re-opening
   * spans by hand. The cost is that constructs spanning several lines (block
   * comments, multi-line template literals) are highlighted line-locally.
   */
  function highlight(code: string): string | null {
    const lang = language()
    if (!lang || !code) return null
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      return null
    }
  }

  return (
    <div
      data-testid="git-diff-pane"
      /* `code-highlight` puts this subtree in scope of the hljs token palette
         in app.css (previously reachable only under `.markdown`). */
      class="code-highlight flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <div class="flex items-center gap-2 border-b px-2 py-1">
        <span class="truncate font-mono text-sm" title={props.path}>
          {props.path}
        </span>
        <Show when={props.truncated}>
          <span class="shrink-0 text-sm text-warning">{t('git.diffTruncated')}</span>
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
                            {chunk.content}
                          </div>
                          <For each={chunk.changes}>
                            {(change) => {
                              const oldLn =
                                change.type === 'add'
                                  ? ''
                                  : change.type === 'del'
                                    ? change.ln
                                    : change.ln1
                              const newLn =
                                change.type === 'del'
                                  ? ''
                                  : change.type === 'add'
                                    ? change.ln
                                    : change.ln2
                              // Add/delete now reads from the row tint plus the
                              // marker glyph; the code itself keeps its syntax
                              // colours instead of being flattened to one hue.
                              const tone =
                                change.type === 'add'
                                  ? 'bg-success/10'
                                  : change.type === 'del'
                                    ? 'bg-destructive/10'
                                    : ''
                              const markerTone =
                                change.type === 'add'
                                  ? 'text-success'
                                  : change.type === 'del'
                                    ? 'text-destructive'
                                    : 'text-muted-foreground'
                              // parse-diff keeps git's leading +/-/space marker
                              // on the content; it is not code, so it is split
                              // off before highlighting.
                              const marker = change.content.slice(0, 1)
                              const code = change.content.slice(1)
                              const highlighted = highlight(code)
                              return (
                                <div class={`flex font-mono text-sm ${tone}`}>
                                  <span class="w-12 shrink-0 select-none px-1 text-right text-muted-foreground">
                                    {oldLn}
                                  </span>
                                  <span class="w-12 shrink-0 select-none px-1 text-right text-muted-foreground">
                                    {newLn}
                                  </span>
                                  <pre class="m-0 flex-1 whitespace-pre-wrap break-all px-2">
                                    <span class={`select-none ${markerTone}`}>{marker}</span>
                                    <Show when={highlighted} fallback={<span>{code}</span>}>
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
