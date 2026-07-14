import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js'
import { ChevronsRight, ChevronsLeft, ChevronDown, Loader2, Plus, Send, Square } from 'lucide-solid'
import { format as formatTimeago, register as registerTimeago } from 'timeago.js'
import zhCNTimeago from 'timeago.js/lib/lang/zh_CN.js'
import { enShort } from '../lib/timeago-locale.js'
import { api, type SessionInfo, type SessionMessage } from '../lib/api.js'
import { subscribeSession, subscribeSessions, type SessionEvent } from '../lib/sse.js'
import { activeProjectId } from '../lib/project.js'
import { clearRequestedChatSession, requestedChatSessionId } from '../lib/chat-session-request.js'
import { t, useTranslation } from '../i18n/index.js'
import { Button } from './ui/button.jsx'
import { Card } from './ui/card.jsx'
import { MentionTextarea } from './MentionTextarea.jsx'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible.jsx'

const COLLAPSED_KEY = 'yorz.layout.col2.collapsed'
const WIDTH_KEY = 'yorz.layout.col2.width'
const LIST_COLLAPSED_KEY = 'yorz.chat.sessionList.collapsed'
const DEFAULT_WIDTH = 340
const MIN_WIDTH = 260
/** Fallback cap when there is no window (SSR / tests). */
const FALLBACK_MAX_WIDTH = 960
/** Chat may be dragged out to 80% of the viewport. */
const MAX_WIDTH_RATIO = 0.8
const AUTO_SCROLL_THRESHOLD = 96

// Abbreviated English ("5m ago") — the stock en_US pack overflows the list column.
registerTimeago('en', enShort)
registerTimeago('zh-CN', zhCNTimeago)

function maxWidth(): number {
  if (typeof window === 'undefined') return FALLBACK_MAX_WIDTH
  return Math.max(MIN_WIDTH, Math.round(window.innerWidth * MAX_WIDTH_RATIO))
}

function clampWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WIDTH
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(n)))
}

function readLocal(key: string, fallback: string): string {
  try {
    return (typeof window !== 'undefined' && window.localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  } catch {
    // ignore quota
  }
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
}

function messageToEntry(m: SessionMessage): ChatEntry {
  const text = m.parts
    .map((p) => {
      if (p.type === 'text') return p.text
      if (p.type === 'tool-use') return `\n${t('chat.toolUse', { name: p.name })}\n`
      return ''
    })
    .join('')
  return { role: m.role, text }
}

export const ChatPanel: Component = () => {
  let messagesEl: HTMLDivElement | undefined
  const { lng } = useTranslation()

  const [collapsed, setCollapsed] = createSignal(readLocal(COLLAPSED_KEY, '0') === '1')
  const [width, setWidth] = createSignal(
    clampWidth(Number(readLocal(WIDTH_KEY, String(DEFAULT_WIDTH)))),
  )
  // Collapsed by default: the list is a switcher, not the primary surface.
  const [listOpen, setListOpen] = createSignal(readLocal(LIST_COLLAPSED_KEY, '1') !== '1')
  const [activeSid, setActiveSid] = createSignal<string>('')
  const [entries, setEntries] = createSignal<ChatEntry[]>([])
  const [input, setInput] = createSignal('')
  const [autoScroll, setAutoScroll] = createSignal(true)
  const [timeTick, setTimeTick] = createSignal(Date.now())
  // Live run status per session id, seeded from the list response and kept in
  // sync by the project-level `sessions` SSE topic.
  const [runningSids, setRunningSids] = createSignal<Record<string, boolean>>({})

  const [sessions, { refetch: refetchSessions }] = createResource(
    () => activeProjectId() || undefined,
    (pid) => api.listSessions(pid),
  )

  // Rebuild running state from each list response: the server's `running` set is
  // the authority, SSE only carries transitions. Rebuilding (rather than merging)
  // is what makes a dropped `running=false` event self-heal — any refetch, such as
  // the one selectSession() fires, reconciles the map back to the truth and drops
  // ids that no longer exist (e.g. left over from another project).
  //
  // The one entry we must NOT drop is a just-sent turn whose session is not in the
  // list yet: the POST is in flight, so the server may not have marked it running
  // when this response was built. Keep the active session's optimistic `true`.
  createEffect(() => {
    const list = sessions()
    if (!list) return
    setRunningSids((prev) => {
      const next: Record<string, boolean> = {}
      for (const s of list) next[s.id] = Boolean(s.running)
      const sid = activeSid()
      if (sid && !(sid in next) && prev[sid] === true) next[sid] = true
      return next
    })
  })

  // Switching projects invalidates every session id we hold.
  createEffect(() => {
    activeProjectId()
    setActiveSid('')
    setRunningSids({})
    setEntries([])
  })

  // Project-level run status: lights up the spinner on sessions other than the
  // active one (whose events arrive on the per-session topic).
  createEffect(() => {
    const pid = activeProjectId()
    if (!pid) return
    const unsub = subscribeSessions(pid, {
      onStatus: (ev) => {
        setRunningSids((prev) => ({ ...prev, [ev.sessionId]: ev.running }))
        // A session's first turn just finished — it now has a transcript and
        // belongs in the list.
        if (!ev.running) void refetchSessions()
      },
    })
    onCleanup(unsub)
  })

  const isRunning = (sid: string): boolean => runningSids()[sid] === true
  const activeRunning = createMemo(() => {
    const sid = activeSid()
    return sid ? isRunning(sid) : false
  })
  const runningCount = createMemo(() => (sessions() ?? []).filter((s) => isRunning(s.id)).length)

  /**
   * The single entry point for switching sessions (list click, spec-page request,
   * new session). The refetch is the self-heal: it re-seeds `runningSids` from the
   * server, so a session whose `running=false` event was lost (SSE reconnect, page
   * reload mid-turn) cannot stay stuck with its Send button disabled.
   */
  function selectSession(sid: string): void {
    if (!sid || sid === activeSid()) return
    setActiveSid(sid)
    void refetchSessions()
  }

  // A spec page requested that Chat switch to a specific (per-spec) session.
  createEffect(() => {
    const sid = requestedChatSessionId()
    if (!sid) return
    clearRequestedChatSession()
    selectSession(sid)
    if (collapsed()) {
      setCollapsed(false)
      writeLocal(COLLAPSED_KEY, '0')
    }
  })

  function toggle() {
    const next = !collapsed()
    setCollapsed(next)
    writeLocal(COLLAPSED_KEY, next ? '1' : '0')
  }

  function toggleList(open: boolean) {
    setListOpen(open)
    writeLocal(LIST_COLLAPSED_KEY, open ? '0' : '1')
  }

  // The 80% cap is viewport-relative: re-clamp when the window shrinks.
  onMount(() => {
    const onResize = () => {
      const next = clampWidth(width())
      if (next !== width()) {
        setWidth(next)
        writeLocal(WIDTH_KEY, String(next))
      }
    }
    window.addEventListener('resize', onResize)
    onCleanup(() => window.removeEventListener('resize', onResize))
  })

  onMount(() => {
    const tick = window.setInterval(() => setTimeTick(Date.now()), 60_000)
    onCleanup(() => window.clearInterval(tick))
  })

  // --- resize (mirrors ProjectsSidebar's rAF drag) ---
  let dragState: { startX: number; startW: number; raf: number | null } | null = null
  let docMove: ((e: MouseEvent) => void) | null = null
  let docUp: (() => void) | null = null
  function beginResize(ev: MouseEvent) {
    if (collapsed()) return
    ev.preventDefault()
    dragState = { startX: ev.clientX, startW: width(), raf: null }
    document.body.classList.add('is-resizing')
    docMove = (e: MouseEvent) => {
      if (!dragState) return
      const next = clampWidth(dragState.startW + (e.clientX - dragState.startX))
      if (dragState.raf != null) return
      dragState.raf = requestAnimationFrame(() => {
        if (!dragState) return
        dragState.raf = null
        setWidth(next)
      })
    }
    docUp = () => {
      if (dragState?.raf != null) cancelAnimationFrame(dragState.raf)
      dragState = null
      document.body.classList.remove('is-resizing')
      if (docMove) document.removeEventListener('mousemove', docMove)
      if (docUp) document.removeEventListener('mouseup', docUp)
      docMove = null
      docUp = null
      writeLocal(WIDTH_KEY, String(width()))
    }
    document.addEventListener('mousemove', docMove)
    document.addEventListener('mouseup', docUp)
  }
  onCleanup(() => {
    if (docMove) document.removeEventListener('mousemove', docMove)
    if (docUp) document.removeEventListener('mouseup', docUp)
    document.body.classList.remove('is-resizing')
  })

  // --- session selection → load history + subscribe to live stream ---
  createEffect(() => {
    const pid = activeProjectId()
    const sid = activeSid()
    if (!pid || !sid) return
    let disposed = false
    setAutoScroll(true)
    setEntries([])
    void api
      .getSessionMessages(pid, sid)
      .then((msgs) => {
        if (!disposed) setEntries(msgs.map(messageToEntry))
      })
      .catch(() => {})

    const sub = subscribeSession(pid, sid, {
      onEvent: (ev: SessionEvent) => {
        if (ev.type === 'text') appendAssistant(ev.delta)
        else if (ev.type === 'tool-use') {
          appendAssistant(`\n${t('chat.toolUse', { name: ev.name })}\n`)
        } else if (ev.type === 'turn-completed') {
          setRunningSids((prev) => ({ ...prev, [sid]: false }))
        } else if (ev.type === 'error') {
          appendAssistant(`\n${t('chat.errorMessage', { message: ev.message })}\n`)
          setRunningSids((prev) => ({ ...prev, [sid]: false }))
        } else if (ev.type === 'session-started' && ev.sessionId !== sid) {
          setRunningSids((prev) => ({ ...prev, [sid]: false, [ev.sessionId]: true }))
          setActiveSid(ev.sessionId)
          void refetchSessions()
        }
      },
    })
    onCleanup(() => {
      disposed = true
      sub()
    })
  })

  createEffect(() => {
    entries()
    if (!autoScroll()) return
    requestAnimationFrame(scrollMessagesToBottom)
  })

  function isNearMessagesBottom(el: HTMLDivElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_THRESHOLD
  }

  function scrollMessagesToBottom(): void {
    if (!messagesEl) return
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function onMessagesScroll(): void {
    if (!messagesEl) return
    setAutoScroll(isNearMessagesBottom(messagesEl))
  }

  function formatSessionUpdatedAt(ts: number): string {
    timeTick()
    if (!Number.isFinite(ts) || ts <= 0) return ''
    return formatTimeago(ts, lng())
  }

  function exactSessionUpdatedAt(ts: number): string {
    if (!Number.isFinite(ts) || ts <= 0) return ''
    return new Date(ts).toLocaleString(lng())
  }

  function appendAssistant(delta: string): void {
    setEntries((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.role === 'assistant') {
        return [...prev.slice(0, -1), { role: 'assistant', text: last.text + delta }]
      }
      return [...prev, { role: 'assistant', text: delta }]
    })
  }

  async function newSession() {
    const pid = activeProjectId()
    if (!pid) return
    try {
      const { sessionId } = await api.createSession(pid, {})
      // A brand-new session has no turn in flight. Seed it explicitly: it is not
      // in the list yet (the server hides sessions that never ran a turn), so the
      // list response cannot seed it and Send must not inherit a stale `true`.
      setRunningSids((prev) => ({ ...prev, [sessionId]: false }))
      selectSession(sessionId)
    } catch {
      // surfaced via list refresh failure; keep silent
    }
  }

  async function send() {
    const pid = activeProjectId()
    const sid = activeSid()
    const prompt = input().trim()
    if (!pid || !sid || !prompt || activeRunning()) return
    setInput('')
    setAutoScroll(true)
    setEntries((prev) => [...prev, { role: 'user', text: prompt }])
    setRunningSids((prev) => ({ ...prev, [sid]: true }))
    try {
      await api.sendSessionMessage(pid, sid, prompt)
    } catch (err) {
      appendAssistant(`\n${t('chat.errorMessage', { message: (err as Error).message })}\n`)
      setRunningSids((prev) => ({ ...prev, [sid]: false }))
    }
  }

  async function abort() {
    const pid = activeProjectId()
    const sid = activeSid()
    if (!pid || !sid) return
    await api.abortSession(pid, sid).catch(() => {})
    setRunningSids((prev) => ({ ...prev, [sid]: false }))
  }

  /**
   * Runs after MentionTextarea's own key handling. Two gates before Enter means
   * "send": the mention popup calls preventDefault() when it consumed the key,
   * and an IME's candidate-confirming Enter must never submit a half-typed line.
   */
  function onKeyDown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <aside
      class={`relative flex flex-col border-r bg-card shrink-0 ${
        collapsed() ? 'w-9 transition-[width] duration-150' : ''
      }`}
      style={collapsed() ? undefined : { width: `${width()}px` }}
    >
      <header
        class={`flex items-center border-b ${
          collapsed() ? 'justify-center py-2' : 'justify-between px-2.5 py-2'
        }`}
      >
        <Show
          when={!collapsed()}
          fallback={
            <Button
              variant="outline"
              size="sm"
              class="h-7 w-7 p-0"
              onClick={toggle}
              title={t('chat.expand')}
            >
              <ChevronsRight class="h-4 w-4" />
            </Button>
          }
        >
          <span class="font-semibold tracking-wide">{t('chat.title')}</span>
          <div class="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              class="h-7 w-7 p-0"
              onClick={() => void newSession()}
              title={t('chat.newSession')}
            >
              <Plus class="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-7 w-7 p-0"
              onClick={toggle}
              title={t('chat.collapse')}
            >
              <ChevronsLeft class="h-4 w-4" />
            </Button>
          </div>
        </Show>
      </header>

      <Show when={!collapsed()}>
        <div class="flex min-h-0 flex-1 flex-col">
          <Show when={(sessions() ?? []).length > 0}>
            <Card class="m-2 rounded-lg shadow-none">
              <Collapsible open={listOpen()} onOpenChange={toggleList}>
                <CollapsibleTrigger
                  class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-background"
                  title={listOpen() ? t('chat.collapseSessions') : t('chat.expandSessions')}
                >
                  <Show
                    when={runningCount() > 0}
                    fallback={<span class="font-medium">{t('chat.sessionsLabelPlain')}</span>}
                  >
                    <span class="font-medium">
                      {t('chat.sessionsLabel', { count: runningCount() })}
                    </span>
                  </Show>
                  <ChevronDown
                    class={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
                      listOpen() ? '' : '-rotate-90'
                    }`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul class="m-0 max-h-64 list-none overflow-y-auto border-t py-1">
                    <For each={sessions() ?? []}>
                      {(s: SessionInfo) => (
                        <li>
                          <button
                            type="button"
                            class={`flex w-full items-center gap-1 px-2.5 py-1.5 text-left text-sm ${
                              activeSid() === s.id
                                ? 'bg-background font-semibold'
                                : 'hover:bg-background'
                            }`}
                            title={
                              isRunning(s.id)
                                ? t('chat.sessionTitleRunning', { kind: s.kind, id: s.id })
                                : t('chat.sessionTitle', { kind: s.kind, id: s.id })
                            }
                            onClick={() => selectSession(s.id)}
                          >
                            <Show when={isRunning(s.id)}>
                              <Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                            </Show>
                            <span class="shrink-0 text-xs text-muted-foreground">[{s.kind}]</span>
                            <span class="min-w-0 flex-1 truncate">{s.title || s.id}</span>
                            <span
                              class="ml-auto max-w-20 shrink-0 truncate pl-2 text-right text-[11px] font-normal tabular-nums text-muted-foreground"
                              title={exactSessionUpdatedAt(s.updatedAt)}
                            >
                              {formatSessionUpdatedAt(s.updatedAt)}
                            </span>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </Show>

          <div
            ref={messagesEl}
            class="min-h-0 flex-1 overflow-y-auto px-2.5 py-2"
            onScroll={onMessagesScroll}
          >
            <Show
              when={activeSid()}
              fallback={<p class="text-sm text-muted-foreground">{t('chat.empty')}</p>}
            >
              <For each={entries()}>
                {(e) => (
                  <div
                    class={`mb-2 whitespace-pre-wrap rounded px-2 py-1.5 text-sm ${
                      e.role === 'user' ? 'bg-background' : 'bg-muted'
                    }`}
                  >
                    {e.text}
                  </div>
                )}
              </For>
            </Show>
          </div>

          <div class="border-t p-2">
            <MentionTextarea
              projectId={activeProjectId() || ''}
              value={input()}
              onValueChange={setInput}
              onKeyDown={onKeyDown}
              placeholder={
                activeSid() ? t('chat.inputPlaceholder') : t('chat.noSessionPlaceholder')
              }
              disabled={!activeSid()}
              minRows={2}
              maxRows={10}
              class="mb-1 bg-background px-2 py-1 text-sm"
            />
            <div class="flex justify-end gap-1">
              <Show when={activeRunning()}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void abort()}
                  title={t('chat.abort')}
                >
                  <Square class="mr-1 h-3.5 w-3.5" />
                  {t('chat.abort')}
                </Button>
              </Show>
              <Button
                size="sm"
                onClick={() => void send()}
                disabled={!activeSid() || !input().trim() || activeRunning()}
              >
                <Send class="mr-1 h-3.5 w-3.5" />
                {t('chat.send')}
              </Button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={!collapsed()}>
        <div
          class="absolute right-0 top-0 z-[2] h-full w-1 cursor-col-resize bg-transparent hover:bg-accent/40"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={beginResize}
        />
      </Show>
    </aside>
  )
}
