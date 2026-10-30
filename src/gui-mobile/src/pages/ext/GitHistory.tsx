import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { useNavigate } from '@solidjs/router'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-solid'
import { format as formatTimeago, register as registerTimeago } from 'timeago.js'
import zhCNTimeago from 'timeago.js/lib/lang/zh_CN.js'
import { api, type GitCommit, type GitCommitFile } from '@shared/api/index.js'
import { enShort } from '@shared/lib/timeago-locale.js'
import { Page } from '@/components/Page.jsx'
import { GitDiffView } from '@/components/GitDiffView.jsx'
import { GitFileList } from '@/components/GitFileList.jsx'
import { NoProjectNotice } from '@/components/ListStates.jsx'
import { activeProjectId } from '@/lib/active-project.js'
import { cn } from '@/lib/cn'
import { t, useTranslation } from '@/i18n/index.js'

registerTimeago('en', enShort)
registerTimeago('zh-CN', zhCNTimeago)

/** Read-only commit history page reached from the extension Git menu. */
export const GitHistory: Component = () => {
  const navigate = useNavigate()
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
    const pid = activeProjectId()
    if (!pid) {
      setLoading(false)
      return
    }
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
      const page = await api.getGitHistory(pid, nextQuery)
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
    const pid = activeProjectId()
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
    const pid = activeProjectId()
    const cursor = nextCursor()
    if (!pid || cursor === null || loadingMore()) return
    const request = historyRequest
    setLoadingMore(true)
    setError(null)
    try {
      const page = await api.getGitHistory(pid, query(), cursor)
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
    const pid = activeProjectId()
    if (!pid) return
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
      const result = await api.getGitCommitFiles(pid, commit.sha)
      if (request === filesRequest) setFiles(result.files)
    } catch (err) {
      if (request === filesRequest) setFilesError((err as Error).message)
    } finally {
      if (request === filesRequest) setFilesLoading(false)
    }
  }

  const [diff] = createResource(
    () => {
      const pid = activeProjectId()
      const sha = expandedSha()
      const path = activePath()
      return pid && sha && path ? { pid, sha, path } : null
    },
    (key) => api.getGitCommitFileDiff(key.pid, key.sha, key.path),
  )

  return (
    <Page title={t('git.history')} fill onBack={() => navigate('/ext/git')}>
      <Show when={activeProjectId()} fallback={<NoProjectNotice />}>
        <div class="shrink-0 border-b border-border bg-card px-4 py-3">
          <input
            type="search"
            class="w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:border-primary"
            value={input()}
            placeholder={t('git.historySearchPlaceholder')}
            aria-label={t('git.historySearchPlaceholder')}
            onInput={(event) => changeQuery(event.currentTarget.value)}
          />
        </div>

        <div
          class={cn(
            'scroll-y min-h-0 divide-y-[0.5px] divide-border bg-card',
            activePath() ? 'max-h-[52dvh] shrink-0' : 'flex-1',
          )}
        >
          <Show
            when={!loading()}
            fallback={<HistoryNotice loading text={t('git.historyLoading')} />}
          >
            <Show when={!error()} fallback={<HistoryNotice text={error()!} tone="error" />}>
              <Show
                when={commits().length > 0}
                fallback={<HistoryNotice text={t('git.historyEmpty')} />}
              >
                <For each={commits()}>
                  {(commit) => (
                    <article>
                      <button
                        type="button"
                        class="grid min-h-14 w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-2 text-left active:bg-accent"
                        aria-expanded={expandedSha() === commit.sha}
                        onClick={() => void toggleCommit(commit)}
                      >
                        <span class="flex min-w-0 items-center gap-2 text-sm font-medium">
                          {expandedSha() === commit.sha ? (
                            <ChevronDown size={16} class="shrink-0" />
                          ) : (
                            <ChevronRight size={16} class="shrink-0" />
                          )}
                          <span class="line-clamp-2 break-words">{commit.subject}</span>
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
                        <div class="divide-y-[0.5px] divide-border border-t bg-muted/20">
                          <Show
                            when={!filesLoading()}
                            fallback={<HistoryNotice loading text={t('git.historyFilesLoading')} />}
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
                                  onSelect={(path) =>
                                    setActivePath((prev) => (prev === path ? null : path))
                                  }
                                />
                              </Show>
                            </Show>
                          </Show>
                        </div>
                      </Show>
                    </article>
                  )}
                </For>
                <Show when={nextCursor() !== null}>
                  <button
                    type="button"
                    class="flex min-h-12 w-full items-center justify-center gap-2 px-4 text-sm text-primary active:bg-accent disabled:opacity-40"
                    disabled={loadingMore()}
                    onClick={() => void loadMore()}
                  >
                    <Show when={loadingMore()}>
                      <Loader2 size={16} class="animate-spin" />
                    </Show>
                    {loadingMore() ? t('git.historyLoadingMore') : t('git.historyLoadMore')}
                  </button>
                </Show>
              </Show>
            </Show>
          </Show>
        </div>

        <Show when={activePath()}>
          {(path) => (
            <GitDiffView
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
      </Show>
    </Page>
  )
}

const HistoryNotice: Component<{ text: string; loading?: boolean; tone?: 'error' }> = (props) => (
  <p
    class={cn(
      'flex items-center justify-center gap-2 px-4 py-8 text-center text-sm',
      props.tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
    )}
  >
    <Show when={props.loading}>
      <Loader2 size={16} class="animate-spin" />
    </Show>
    {props.text}
  </p>
)
