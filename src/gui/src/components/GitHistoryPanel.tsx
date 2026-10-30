import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-solid'
import { format as formatTimeago, register as registerTimeago } from 'timeago.js'
import zhCNTimeago from 'timeago.js/lib/lang/zh_CN.js'
import { enShort } from '@shared/lib/timeago-locale.js'
import { api, type GitCommit, type GitCommitFile } from '../lib/api.js'
import { t, useTranslation } from '../i18n/index.js'
import { Button } from './ui/button.jsx'
import { Input } from './ui/input.jsx'
import { DiffView } from './DiffView.jsx'
import { GitFileList } from './GitFileList.jsx'

registerTimeago('en', enShort)
registerTimeago('zh-CN', zhCNTimeago)

interface GitHistoryPanelProps {
  projectId: () => string
}

/** Read-only commit history browser for the desktop Git page. */
export const GitHistoryPanel: Component<GitHistoryPanelProps> = (props) => {
  const { lng } = useTranslation()
  const [input, setInput] = createSignal('')
  const [query, setQuery] = createSignal('')
  const [commits, setCommits] = createSignal<GitCommit[]>([])
  const [nextCursor, setNextCursor] = createSignal<number | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [expandedSha, setExpandedSha] = createSignal<string | null>(null)
  const [files, setFiles] = createSignal<GitCommitFile[]>([])
  const [filesLoading, setFilesLoading] = createSignal(false)
  const [filesError, setFilesError] = createSignal<string | null>(null)
  const [activePath, setActivePath] = createSignal<string | null>(null)

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let historyRequest = 0
  let filesRequest = 0
  let loadedProject = ''
  onCleanup(() => clearTimeout(searchTimer))

  async function resetAndLoad(nextQuery: string): Promise<void> {
    const request = ++historyRequest
    setQuery(nextQuery)
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    setCommits([])
    setNextCursor(null)
    setExpandedSha(null)
    setActivePath(null)
    try {
      const page = await api.getGitHistory(props.projectId(), nextQuery)
      if (request !== historyRequest) return
      setCommits(page.commits)
      setNextCursor(page.nextCursor)
    } catch (err) {
      if (request === historyRequest) setError((err as Error).message)
    } finally {
      if (request === historyRequest) setLoading(false)
    }
  }

  createEffect(() => {
    const pid = props.projectId()
    if (!pid || pid === loadedProject) return
    loadedProject = pid
    void resetAndLoad(input().trim())
  })

  function changeQuery(value: string): void {
    setInput(value)
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void resetAndLoad(value.trim()), 250)
  }

  async function loadMore(): Promise<void> {
    const cursor = nextCursor()
    if (cursor === null || loadingMore()) return
    const request = historyRequest
    setLoadingMore(true)
    setError(null)
    try {
      const page = await api.getGitHistory(props.projectId(), query(), cursor)
      if (request !== historyRequest) return
      setCommits((prev) => {
        const seen = new Set(prev.map((commit) => commit.sha))
        return [...prev, ...page.commits.filter((commit) => !seen.has(commit.sha))]
      })
      setNextCursor(page.nextCursor)
    } catch (err) {
      if (request === historyRequest) setError((err as Error).message)
    } finally {
      if (request === historyRequest) setLoadingMore(false)
    }
  }

  async function toggleCommit(commit: GitCommit): Promise<void> {
    if (expandedSha() === commit.sha) {
      setExpandedSha(null)
      setActivePath(null)
      return
    }
    const request = ++filesRequest
    setExpandedSha(commit.sha)
    setFiles([])
    setActivePath(null)
    setFilesLoading(true)
    setFilesError(null)
    try {
      const result = await api.getGitCommitFiles(props.projectId(), commit.sha)
      if (request === filesRequest) setFiles(result.files)
    } catch (err) {
      if (request === filesRequest) setFilesError((err as Error).message)
    } finally {
      if (request === filesRequest) setFilesLoading(false)
    }
  }

  const [diff] = createResource(
    () => {
      const sha = expandedSha()
      const path = activePath()
      const pid = props.projectId()
      return sha && path && pid ? { sha, path, pid } : null
    },
    (key) => api.getGitCommitFileDiff(key.pid, key.sha, key.path),
  )

  return (
    <div class="flex min-h-0 flex-1 gap-2">
      <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <Input
          type="search"
          value={input()}
          onInput={(event) => changeQuery(event.currentTarget.value)}
          placeholder={t('git.historySearchPlaceholder')}
          aria-label={t('git.historySearchPlaceholder')}
        />

        <div class="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
          <Show
            when={!loading()}
            fallback={<HistoryNotice loading text={t('git.historyLoading')} />}
          >
            <Show when={!error()} fallback={<HistoryNotice text={error()!} tone="error" />}>
              <Show
                when={commits().length > 0}
                fallback={<HistoryNotice text={t('git.historyEmpty')} />}
              >
                <div class="divide-y">
                  <For each={commits()}>
                    {(commit) => (
                      <article>
                        <button
                          type="button"
                          class="grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-3 py-2 text-left hover:bg-accent"
                          aria-expanded={expandedSha() === commit.sha}
                          onClick={() => void toggleCommit(commit)}
                        >
                          <span class="flex min-w-0 items-center gap-2 font-medium">
                            {expandedSha() === commit.sha ? (
                              <ChevronDown class="h-4 w-4 shrink-0" />
                            ) : (
                              <ChevronRight class="h-4 w-4 shrink-0" />
                            )}
                            <span class="truncate">{commit.subject}</span>
                          </span>
                          <time
                            class="text-xs text-muted-foreground"
                            datetime={commit.committedAt}
                            title={commit.committedAt}
                          >
                            {formatTimeago(commit.committedAt, lng())}
                          </time>
                          <span class="col-start-1 ml-6 truncate text-xs text-muted-foreground">
                            {commit.authorName}
                          </span>
                          <code class="col-start-2 text-xs text-muted-foreground">
                            {commit.sha.slice(0, 8)}
                          </code>
                        </button>
                        <Show when={expandedSha() === commit.sha}>
                          <div class="border-t bg-muted/20 py-1">
                            <Show
                              when={!filesLoading()}
                              fallback={
                                <HistoryNotice loading text={t('git.historyFilesLoading')} />
                              }
                            >
                              <Show
                                when={!filesError()}
                                fallback={<HistoryNotice text={filesError()!} tone="error" />}
                              >
                                <Show
                                  when={files().length > 0}
                                  fallback={<HistoryNotice text={t('git.historyNoFiles')} />}
                                >
                                  <GitFileList
                                    files={files()}
                                    activePath={activePath()}
                                    onSelect={setActivePath}
                                  />
                                </Show>
                              </Show>
                            </Show>
                          </div>
                        </Show>
                      </article>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </div>

        <Show when={nextCursor() !== null}>
          <Button variant="link" disabled={loadingMore()} onClick={() => void loadMore()}>
            <Show when={loadingMore()}>
              <Loader2 class="mr-1 h-4 w-4 animate-spin" />
            </Show>
            {loadingMore() ? t('git.historyLoadingMore') : t('git.historyLoadMore')}
          </Button>
        </Show>
      </section>

      <Show when={activePath()}>
        {(path) => (
          <DiffView
            path={path()}
            patch={diff()?.patch ?? ''}
            binary={diff()?.binary ?? false}
            truncated={diff()?.truncated ?? false}
            loading={diff.loading}
            error={diff.error ? (diff.error as Error).message : null}
            onClose={() => setActivePath(null)}
          />
        )}
      </Show>
    </div>
  )
}

const HistoryNotice: Component<{ text: string; loading?: boolean; tone?: 'error' }> = (props) => (
  <p
    class={`flex items-center justify-center gap-2 px-4 py-8 text-sm ${
      props.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
    }`}
  >
    <Show when={props.loading}>
      <Loader2 class="h-4 w-4 animate-spin" />
    </Show>
    {props.text}
  </p>
)
