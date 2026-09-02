import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js'
import {
  ChevronsRight,
  ChevronsLeft,
  ChevronDown,
  Loader2,
  Paperclip,
  Plus,
  Send,
  Square,
} from 'lucide-solid'
import { format as formatTimeago, register as registerTimeago } from 'timeago.js'
import zhCNTimeago from 'timeago.js/lib/lang/zh_CN.js'
import { enShort } from '../lib/timeago-locale.js'
import { api, type AgentUsageWindow, type CustomInstruction, type SessionInfo } from '../lib/api.js'
import { globalConfig, saveCustomInstructions } from '../lib/global-config.js'
import {
  projectInstructions,
  refreshProjectInstructions,
  saveProjectInstructions,
} from '../lib/project-instructions.js'
import {
  buildSlashReplacement,
  mergeScopedInstructions,
  type SlashCommandScope,
} from '../lib/slash-commands.js'
import { subscribeSession, subscribeSessions, type SessionEvent } from '../lib/sse.js'
import { activeProjectId } from '../lib/project.js'
import { clearRequestedChatSession, requestedChatSessionId } from '../lib/chat-session-request.js'
import { focusMode, exitFocusMode } from '../lib/layout-focus.js'
import {
  groupParts,
  messagesToParts,
  specMessagesToParts,
  type ChatPart,
} from '../lib/chat-blocks.js'
import { createHistoryLoadGate, planHistoryLoad } from '../lib/chat-history-load.js'
import { findGroupBySession, groupSessions, type SessionGroup } from '../lib/session-groups.js'
import { renderMarkdown } from '../lib/markdown.js'
import { t, useTranslation } from '../i18n/index.js'
import { Button } from './ui/button.jsx'
import { Card } from './ui/card.jsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.jsx'
import { Input } from './ui/input.jsx'
import { AutoResizeTextarea } from './ui/textarea.jsx'
import { toast } from './ui/toast.jsx'
import { MentionTextarea, type SlashCommand } from './MentionTextarea.jsx'
import { ChatToolBlock } from './ChatToolBlock.jsx'
import { ChatContextBlock } from './ChatContextBlock.jsx'
import { Collapsible, CollapsibleContent } from './ui/collapsible.jsx'
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
} from './ui/radio-group.jsx'
import { AttachmentList } from './AttachmentList.jsx'
import { ACCEPT_MIME, MAX_COUNT, createAttachments } from '../lib/attachments.js'

const COLLAPSED_KEY = 'yorz.layout.col2.collapsed'
const WIDTH_KEY = 'yorz.layout.col2.width'
const LIST_COLLAPSED_KEY = 'yorz.chat.sessionList.collapsed'
const SESSION_LIST_ROWS_KEY = 'yorz.chat.sessionList.rows'
const LEGACY_SESSION_LIST_LIMIT_KEY = 'yorz.chat.sessionList.limit'
const SHOW_HISTORY_KEY = 'yorz.chat.sessionList.showHistory'
const SESSION_LIST_ROW_OPTIONS = [3, 5, 10] as const
const SESSION_ROW_HEIGHT_PX = 28
const DEFAULT_WIDTH = 340
const DEFAULT_WIDTH_RATIO = 0.4
const MIN_WIDTH = 260
/** Fallback cap when there is no window (SSR / tests). */
const FALLBACK_MAX_WIDTH = 960
/** Chat may be dragged out to 80% of the viewport. */
const MAX_WIDTH_RATIO = 0.8
const AUTO_SCROLL_THRESHOLD = 96
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * How long a draft's first send waits for its session subscription to attach.
 * On timeout we POST anyway: losing a few early deltas (they are still in the
 * transcript) beats wedging Send behind a dropped `ready` event.
 */
const SUBSCRIBE_READY_TIMEOUT_MS = 1500
/**
 * Streaming deltas arrive far faster than a human reads, and every flush re-parses
 * the whole markdown of the block being streamed. Batching them on a short timer
 * keeps that cost off the hot path without a visible lag.
 */
const STREAM_FLUSH_MS = 80

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

function defaultWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  return clampWidth(window.innerWidth * DEFAULT_WIDTH_RATIO)
}

function closestFileLink(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-file-link="true"]')
}

function readWidth(): number {
  try {
    if (typeof window === 'undefined') return DEFAULT_WIDTH
    const raw = window.localStorage.getItem(WIDTH_KEY)
    if (!raw) return defaultWidth()
    const n = Number(raw)
    return Number.isFinite(n) ? clampWidth(n) : defaultWidth()
  } catch {
    return defaultWidth()
  }
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

type SessionListRows = (typeof SESSION_LIST_ROW_OPTIONS)[number]

function isSessionListRows(value: number): value is SessionListRows {
  return SESSION_LIST_ROW_OPTIONS.includes(value as SessionListRows)
}

function readSessionListRows(): SessionListRows {
  const raw = Number(readLocal(SESSION_LIST_ROWS_KEY, ''))
  if (isSessionListRows(raw)) return raw
  const legacyRaw = Number(readLocal(LEGACY_SESSION_LIST_LIMIT_KEY, ''))
  if (isSessionListRows(legacyRaw)) return legacyRaw
  return readLocal(SHOW_HISTORY_KEY, '0') === '1' ? 10 : 3
}

/**
 * Prompt textareas in the command dialog grow from 3 up to 10 lines, then
 * scroll — past the cap a long prompt would push the dialog's footer off screen.
 */
const PROMPT_MIN_ROWS = 3
const PROMPT_MAX_ROWS = 10

function normalizeSlashCommandName(value: string): string {
  return value.trim().replace(/^\/+/, '')
}

function validSlashCommandName(value: string): boolean {
  return /^[\w-]+$/.test(value)
}

function makeCustomSlashCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const ChatPanel: Component = () => {
  let messagesEl: HTMLDivElement | undefined
  let fileInputEl: HTMLInputElement | undefined
  const { lng } = useTranslation()

  // Transient chat attachments — uploaded to the same draft store as NewSpec, then
  // referenced by path in the outgoing prompt. Reset after each send and whenever
  // the active session / project changes.
  const attachments = createAttachments({ projectId: () => activeProjectId() || '' })
  // Both scopes in one list, project first and shadowing same-named global
  // commands — the server merges identically, so the picker cannot offer a
  // command that resolves to a different one on send.
  const customSlashCommands = createMemo(() =>
    mergeScopedInstructions(
      projectInstructions(activeProjectId() || ''),
      globalConfig().customInstructions,
    ),
  )
  createEffect(() => {
    const pid = activeProjectId() || ''
    if (pid) void refreshProjectInstructions(pid)
  })
  const [customCommandOpen, setCustomCommandOpen] = createSignal(false)
  const [customCommandName, setCustomCommandName] = createSignal('')
  const [customCommandDescription, setCustomCommandDescription] = createSignal('')
  const [customCommandHiddenPrompt, setCustomCommandHiddenPrompt] = createSignal('')
  const [customCommandPrefill, setCustomCommandPrefill] = createSignal('')
  const [customCommandScope, setCustomCommandScope] = createSignal<SlashCommandScope>('project')
  const [customCommandError, setCustomCommandError] = createSignal<string | null>(null)
  const [customCommandBusy, setCustomCommandBusy] = createSignal(false)
  const [editingCommandId, setEditingCommandId] = createSignal<string | null>(null)
  const [deletingCommand, setDeletingCommand] = createSignal<SlashCommand | null>(null)
  const [deleteCommandBusy, setDeleteCommandBusy] = createSignal(false)
  const slashCommands = createMemo<SlashCommand[]>(() => {
    lng()
    const custom = customSlashCommands().map((cmd) => {
      const value = `/${cmd.name}`
      return {
        value,
        label: value,
        // Never fall back to the hidden prompt: it is by definition the part the
        // user does not see, so surfacing it in the picker contradicts the field.
        description: cmd.description || t('chat.customSlashCommandNoDescription'),
        replacement: buildSlashReplacement(cmd.name, cmd.prefill),
        customId: cmd.id,
        editable: true,
        editLabel: t('chat.editCustomSlashCommand', { name: cmd.name }),
        deletable: true,
        deleteLabel: t('chat.deleteCustomSlashCommand', { name: cmd.name }),
      }
    })
    return [
      {
        value: '/yorz-debug',
        description: t('chat.slashCommandYorzDebug'),
      },
      {
        value: '/yorz-spec',
        description: t('chat.slashCommandYorzSpec'),
      },
      ...custom,
      {
        value: '/add-command',
        label: t('chat.addSlashCommandOption'),
        description: t('chat.addSlashCommandOptionDescription'),
        action: 'add',
        icon: 'plus',
      },
    ]
  })

  const [collapsed, setCollapsed] = createSignal(readLocal(COLLAPSED_KEY, '0') === '1')
  const [width, setWidth] = createSignal(readWidth())
  // Expanded by default (localStorage memory wins): the list now carries the
  // session-list height control, so it must be discoverable without a click.
  const [listOpen, setListOpen] = createSignal(readLocal(LIST_COLLAPSED_KEY, '0') !== '1')
  const [sessionListRows, setSessionListRows] = createSignal<SessionListRows>(readSessionListRows())
  /**
   * `''` is the Untitled (draft) session: a fully usable panel whose session does
   * not exist server-side yet — it is created on the first send. Panel usability
   * is keyed off the project, not off this id.
   */
  const [activeSid, setActiveSid] = createSignal<string>('')
  /**
   * The structured part stream — the single source of truth for the message area.
   * Both the transcript API and the live SSE stream translate into these, so a
   * reloaded session renders identically to one you watched stream in.
   */
  const [parts, setParts] = createSignal<ChatPart[]>([])
  const blocks = createMemo(() => groupParts(parts()))
  const [input, setInput] = createSignal('')
  const [autoScroll, setAutoScroll] = createSignal(true)
  const [timeTick, setTimeTick] = createSignal(Date.now())
  /** A draft's create→subscribe→send handshake is in flight; blocks double-create. */
  const [starting, setStarting] = createSignal(false)
  // Live run status per session id, seeded from the list response and kept in
  // sync by the project-level `sessions` SSE topic.
  const [runningSids, setRunningSids] = createSignal<Record<string, boolean>>({})

  /**
   * Sessions created locally in this tab that have no transcript on disk yet:
   * their `entries` live only in memory (optimistic user message + live deltas),
   * so the selection effect must NOT clear them and refetch an empty transcript.
   * An id leaves the set once its first turn completes and gets persisted.
   */
  const freshSids = new Set<string>()
  const [freshRevision, setFreshRevision] = createSignal(0)
  let displayedSid = ''
  /**
   * Spec whose aggregate transcript the message area currently holds, or
   * undefined when it holds a single session. Tracked alongside `displayedSid`
   * because "same session" alone cannot tell a spec row's full history apart
   * from the single round that was loaded before the list knew about the spec.
   */
  let displayedSpecId: string | undefined
  /**
   * Owns the async half of a history read. Every path that takes the message
   * area over — a new load, a project switch, dropping back to the draft —
   * invalidates the read in flight, and ONLY those paths do: a re-run of the
   * history effect that decides to change nothing must leave the pending read
   * alone, or a `clear: true` load gets blanked and then orphaned.
   */
  const historyGate = createHistoryLoadGate()
  /** sid → deferred resolved by the session topic's `ready` event. */
  const readyWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>()

  function waitForSubscription(sid: string): Promise<void> {
    let entry = readyWaiters.get(sid)
    if (!entry) {
      let resolve: () => void = () => {}
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      entry = { promise, resolve }
      readyWaiters.set(sid, entry)
    }
    return entry.promise
  }

  function markSubscribed(sid: string): void {
    void waitForSubscription(sid)
    readyWaiters.get(sid)?.resolve()
  }

  function markFreshPersisted(sid: string): void {
    if (!freshSids.delete(sid)) return
    setFreshRevision((v) => v + 1)
  }

  const [sessions, { refetch: refetchSessions }] = createResource(
    () => activeProjectId() || undefined,
    (pid) => api.listSessions(pid),
  )
  const [usageStatus] = createResource(
    () => {
      const pid = activeProjectId()
      return pid && !activeSid() ? pid : undefined
    },
    (pid) => api.getAgentUsageStatus(pid),
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
    const sid = activeSid()
    let activeFreshChanged = false
    for (const s of list) {
      if (!s.running && freshSids.delete(s.id) && s.id === sid) activeFreshChanged = true
    }
    if (activeFreshChanged) setFreshRevision((v) => v + 1)
    setRunningSids((prev) => {
      const next: Record<string, boolean> = {}
      for (const s of list) next[s.id] = Boolean(s.running)
      if (sid && !(sid in next) && prev[sid] === true) next[sid] = true
      return next
    })
  })

  // Switching projects invalidates every session id we hold — back to Untitled.
  createEffect(
    on(activeProjectId, () => {
      setActiveSid('')
      setRunningSids({})
      resetParts()
      historyGate.invalidate()
      displayedSid = ''
      displayedSpecId = undefined
      setStarting(false)
      freshSids.clear()
      setFreshRevision((v) => v + 1)
      readyWaiters.clear()
      attachments.reset()
    }),
  )

  // Project-level run status: lights up the spinner on sessions other than the
  // active one (whose events arrive on the per-session topic).
  createEffect(() => {
    const pid = activeProjectId()
    if (!pid) return
    const unsub = subscribeSessions(pid, {
      onStatus: (ev) => {
        setRunningSids((prev) => ({ ...prev, [ev.sessionId]: ev.running }))
        // 两个边沿都要重拉列表：running=true 时服务端已刷新该会话的活动时间并让它
        // 上浮，只在结束时重拉会让顺序在整个执行期间都停留在旧位置；running=false
        // 时重拉则是为了把该会话的最终状态（标题、活动时间）落到列表上。
        void refetchSessions()
      },
    })
    onCleanup(unsub)
  })

  const isRunning = (sid: string): boolean => runningSids()[sid] === true
  const activeRunning = createMemo(() => {
    const sid = activeSid()
    return sid ? isRunning(sid) : false
  })
  /**
   * List rows. A spec's rounds each run in their own session (see
   * `createSessionForSpec`), so they are folded back into one row here — the
   * list reads exactly as it did when a spec owned a single session.
   */
  const visibleGroups = createMemo(() => groupSessions(sessions() ?? [], isRunning))
  /** Count rows, not sessions: 3 running rounds of one spec are one busy spec. */
  const runningCount = createMemo(() => visibleGroups().filter((g) => g.running).length)
  /** The row the active session belongs to — drives selection highlighting. */
  const activeGroup = createMemo(() => findGroupBySession(visibleGroups(), activeSid()))
  /**
   * Spec of the active row, or undefined for a plain chat. A memo (not a direct
   * read of the group) so the history effect below only re-runs when the spec
   * identity actually changes — the session list refetches on every SSE status
   * edge, and each of those must not re-read the transcript.
   */
  const activeSpecId = createMemo(() => activeGroup()?.specId)
  /**
   * Whether the list already knows the active session — i.e. whether
   * `activeSpecId` above can be trusted. `selectSession()` sets `activeSid`
   * synchronously but refetches the list asynchronously, so a session the server
   * just created (every run / append / git-ops round gets its own now) is
   * briefly missing from the list, where it is indistinguishable from a plain
   * chat. Boolean memos, so the history effect re-runs on the transition rather
   * than on every rebuild of the group objects.
   */
  const activeSessionKnown = createMemo(() => Boolean(activeGroup()))
  /**
   * The list still owes an answer about the active session: it does not know
   * it yet AND a request is in flight, so it may still turn out to belong to a
   * spec. Once that request settles, `known === false` is the final answer (the
   * session was truncated past `SESSION_LIST_LIMIT`, or the request failed) and
   * the panel falls back to a single-session load rather than waiting forever.
   *
   * Folding `known` in here (rather than passing raw `loading`) keeps this
   * false — and therefore stable — for the whole time a known session is
   * selected, so the list refetch that fires on every SSE status edge does not
   * re-run the history effect twice per edge.
   */
  const activeSessionPending = createMemo(() => !activeSessionKnown() && sessions.loading)

  /**
   * The single entry point for switching sessions (list click, spec-page request,
   * new session). The refetch is the self-heal: it re-seeds `runningSids` from the
   * server, so a session whose `running=false` event was lost (SSE reconnect, page
   * reload mid-turn) cannot stay stuck with its Send button disabled.
   */
  function selectSession(sid: string): void {
    if (!sid || sid === activeSid()) return
    // Refetch BEFORE flipping the id. The history effect runs synchronously on
    // `setActiveSid`, and `sessions.loading` is what tells it the list still
    // owes an answer about this session; ordering it the other way makes the
    // effect see a settled list, conclude the session is a plain chat, and load
    // a single round over the spec row's history.
    void refetchSessions()
    setActiveSid(sid)
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

  // Focus mode hides the panel without touching the persisted flag, so exiting
  // it restores whatever the user actually chose.
  const isCollapsed = () => collapsed() || focusMode()

  function toggle() {
    // While focus mode holds the panel shut the only affordance is "expand" —
    // honour it by leaving focus mode instead of persisting a state the user
    // never picked.
    if (focusMode()) {
      exitFocusMode()
      return
    }
    const next = !collapsed()
    setCollapsed(next)
    writeLocal(COLLAPSED_KEY, next ? '1' : '0')
  }

  function toggleList(open: boolean) {
    setListOpen(open)
    writeLocal(LIST_COLLAPSED_KEY, open ? '0' : '1')
  }

  function changeSessionListRows(value: string) {
    const next = Number(value)
    if (!isSessionListRows(next)) return
    setSessionListRows(next)
    writeLocal(SESSION_LIST_ROWS_KEY, String(next))
  }

  function sessionListRowsLabel(rows: SessionListRows): string {
    if (rows === 3) return t('chat.sessionListRows3')
    if (rows === 5) return t('chat.sessionListRows5')
    return t('chat.sessionListRows10')
  }

  function displaySessionTitle(s: SessionInfo): string {
    const title = s.title.trim()
    return title && title !== s.id && !UUID_RE.test(title) ? title : s.id
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
    if (isCollapsed()) return
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

  // --- session selection → load history ---
  createEffect(() => {
    const pid = activeProjectId()
    const sid = activeSid()
    const specId = activeSpecId()
    // Tracked for spec rows only: a spec's row spans several sessions, so when
    // the current round settles the transcript is re-read to fold that round in
    // (with its divider). Plain chats keep the old load-on-select behaviour.
    // A boolean memo, not `isRunning(sid)`: `runningSids` is replaced wholesale
    // by every list response, so reading it here re-ran this effect on each SSE
    // status edge even though nothing about the content had changed.
    const running = specId ? activeRunning() : false
    const plan = planHistoryLoad({
      sid,
      displayedSid,
      displayedSpecId,
      fresh: freshSids.has(sid),
      listPending: activeSessionPending(),
      known: activeSessionKnown(),
      specId,
      running,
    })
    freshRevision()
    if (!pid || plan.action === 'idle' || plan.action === 'hold' || plan.action === 'keep') return
    // A locally-created session that is still the content on screen: `parts`
    // already holds the optimistic user message plus whatever has streamed in,
    // and it is strictly ahead of the transcript. Reading would only risk
    // overwriting it. `planHistoryLoad` only returns this while
    // `displayedSid === sid` — a fresh session we have switched away from has
    // lost those parts and is read back from the transcript like any other.
    if (plan.action === 'fresh') {
      setAutoScroll(true)
      return
    }

    setAutoScroll(true)
    if (plan.clear) resetParts()
    displayedSid = sid
    displayedSpecId = plan.specId
    const isCurrent = historyGate.begin()
    // Flatten message → parts: tool-result keeps its payload instead of being
    // dropped, so the transcript and the live stream now agree. A spec row reads
    // every session it owns, dividers included.
    const load = plan.specId
      ? api.getSpecMessages(pid, plan.specId).then(specMessagesToParts)
      : api.getSessionMessages(pid, sid).then(messagesToParts)
    void load
      .then((next) => {
        // Not `onCleanup`: the effect re-runs for reasons that have nothing to do
        // with the content, and cancelling there dropped this transcript on the
        // floor after `clear` had already blanked the area. See the gate's docs.
        if (isCurrent()) resetParts(next)
      })
      .catch(() => {})
  })

  // --- session selection → subscribe to the live stream ---
  createEffect(() => {
    const pid = activeProjectId()
    const sid = activeSid()
    if (!pid || !sid) return
    const sub = subscribeSession(pid, sid, {
      onReady: () => markSubscribed(sid),
      onEvent: (ev: SessionEvent) => {
        if (ev.type === 'text') appendAssistantDelta(ev.delta)
        else if (ev.type === 'tool-use') {
          pushPart({ kind: 'tool', name: ev.name, input: ev.input })
        } else if (ev.type === 'tool-result') {
          // Previously unhandled: the result was silently dropped live, yet came
          // back as an empty bubble after a reload. Both paths agree now.
          pushPart({ kind: 'tool', result: ev.text })
        } else if (ev.type === 'turn-completed') {
          // The turn is persisted now — a later re-select should read the
          // transcript rather than trust this tab's in-memory parts. Drain the
          // buffer first, or the tail of the last delta is lost.
          flushDeltas()
          markFreshPersisted(sid)
          setRunningSids((prev) => ({ ...prev, [sid]: false }))
        } else if (ev.type === 'error') {
          appendAssistant(`\n${t('chat.errorMessage', { message: ev.message })}\n`)
          setRunningSids((prev) => ({ ...prev, [sid]: false }))
        } else if (ev.type === 'session-started' && ev.sessionId !== sid) {
          // codex swaps in its own id mid-turn. The new id has no transcript
          // either, so inherit `fresh` — otherwise re-subscribing under the new
          // id would clear the deltas already on screen.
          if (freshSids.has(sid)) freshSids.add(ev.sessionId)
          if (displayedSid === sid) displayedSid = ev.sessionId
          setRunningSids((prev) => ({ ...prev, [sid]: false, [ev.sessionId]: true }))
          // Same ordering rule as selectSession(): the list must already be
          // in flight when the new id goes live.
          void refetchSessions()
          setActiveSid(ev.sessionId)
        }
      },
    })
    onCleanup(() => {
      readyWaiters.delete(sid)
      sub()
    })
  })

  createEffect(() => {
    parts()
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

  function formatUsageReset(ts: string | null): string {
    if (!ts) return t('chat.usageResetUnknown')
    const time = new Date(ts)
    if (!Number.isFinite(time.getTime())) return t('chat.usageResetUnknown')
    return time.toLocaleString(lng())
  }

  function formatUsageWindow(win: AgentUsageWindow): string {
    if (typeof win.utilization !== 'number') {
      return t('chat.usageWindowUnknown', { label: win.label })
    }
    const used = Math.min(100, Math.max(0, Math.round(win.utilization)))
    const remaining = Math.max(0, 100 - used)
    return t('chat.usageWindow', {
      label: win.label,
      remaining,
      used,
      reset: formatUsageReset(win.resetsAt),
    })
  }

  const usageSummary = createMemo(() => {
    lng()
    if (usageStatus.loading) return t('chat.usageLoading')
    const usage = usageStatus()
    if (!usage) return ''
    if (usage.status === 'error') return t('chat.usageError', { kind: usage.kind })
    if (usage.status === 'unavailable' && usage.installCommand) {
      return t('chat.usageInstallHint', { kind: usage.kind, command: usage.installCommand })
    }
    if (usage.status === 'unavailable') return t('chat.usageUnavailable', { kind: usage.kind })
    const windows = usage.windows ?? []
    if (windows.length === 0) return t('chat.usageAvailableNoDetails', { kind: usage.kind })
    return t('chat.usageSummary', {
      kind: usage.kind,
      details: windows.slice(0, 2).map(formatUsageWindow).join(t('chat.usageSeparator')),
    })
  })

  async function copyFilePath(path: string): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(path)
      toast.success(t('chat.filePathCopied'))
    } catch {
      toast.error(t('chat.filePathCopyFailed'))
    }
  }

  function onMessagesClick(e: MouseEvent): void {
    const link = closestFileLink(e.target)
    if (!link || (messagesEl && !messagesEl.contains(link))) return
    const path = link.dataset.filePath
    if (!path) return
    e.preventDefault()
    void copyFilePath(path)
  }

  function onMessagesKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const link = closestFileLink(e.target)
    if (!link || (messagesEl && !messagesEl.contains(link))) return
    const path = link.dataset.filePath
    if (!path) return
    e.preventDefault()
    void copyFilePath(path)
  }

  // --- streaming delta buffer -------------------------------------------------
  /** Deltas seen since the last flush. Never read outside flushDeltas(). */
  let pendingDelta = ''
  let flushTimer: number | null = null

  function withAssistantText(prev: ChatPart[], text: string): ChatPart[] {
    const last = prev[prev.length - 1]
    if (last && last.kind === 'text' && last.role === 'assistant') {
      return [...prev.slice(0, -1), { ...last, text: last.text + text }]
    }
    return [...prev, { kind: 'text', role: 'assistant', text }]
  }

  function flushDeltas(): void {
    if (flushTimer != null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    const delta = pendingDelta
    pendingDelta = ''
    if (!delta) return
    setParts((prev) => withAssistantText(prev, delta))
  }

  /** Buffered append for high-frequency stream deltas. */
  function appendAssistantDelta(delta: string): void {
    pendingDelta += delta
    if (flushTimer != null) return
    flushTimer = window.setTimeout(flushDeltas, STREAM_FLUSH_MS)
  }

  /**
   * Immediate append for one-off assistant text (errors). Flushing first is what
   * preserves arrival order — buffered deltas must land before this text does.
   */
  function appendAssistant(text: string): void {
    flushDeltas()
    setParts((prev) => withAssistantText(prev, text))
  }

  /** Append a non-text part (or a user message), after draining the buffer. */
  function pushPart(part: ChatPart): void {
    flushDeltas()
    setParts((prev) => [...prev, part])
  }

  /** Drop everything on screen, buffer included — a stale delta must not resurface. */
  function resetParts(next: ChatPart[] = []): void {
    if (flushTimer != null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    pendingDelta = ''
    setParts((prev) => (next.length === 0 && prev.length === 0 ? prev : next))
  }

  onCleanup(() => {
    if (flushTimer != null) clearTimeout(flushTimer)
    // The panel is gone; a read still in flight must not write to it.
    historyGate.invalidate()
  })

  /**
   * "New session" no longer hits the server — it drops the panel back to the
   * Untitled draft, and the session is created by the first send. This is what
   * kills the empty-shell sessions the server had to filter out of the list.
   * A no-op when already on the draft (the button is disabled there anyway).
   */
  function newSession(): void {
    if (!activeProjectId() || !activeSid()) return
    setActiveSid('')
    resetParts()
    historyGate.invalidate()
    displayedSid = ''
    displayedSpecId = undefined
    setAutoScroll(true)
    attachments.reset()
  }

  async function send() {
    const pid = activeProjectId()
    const sid = activeSid()
    const prompt = input().trim()
    if (!pid || !prompt || starting() || activeRunning() || attachments.hasPending()) return
    setInput('')
    setAutoScroll(true)
    if (!sid) {
      await sendFromDraft(pid, prompt)
      return
    }
    const did = attachments.draftId() ?? undefined
    pushPart({ kind: 'text', role: 'user', text: prompt })
    setRunningSids((prev) => ({ ...prev, [sid]: true }))
    try {
      await api.sendSessionMessage(pid, sid, prompt, did)
      attachments.reset()
    } catch (err) {
      appendAssistant(`\n${t('chat.errorMessage', { message: (err as Error).message })}\n`)
      setRunningSids((prev) => ({ ...prev, [sid]: false }))
    }
  }

  /**
   * Untitled → live session, in one click. Create and POST race the session
   * subscription: the event stream has no replay buffer, so any delta emitted
   * before our topic attaches is gone. Gate the POST on the server's `ready`
   * event, with a timeout so a lost `ready` degrades gracefully.
   */
  async function sendFromDraft(pid: string, prompt: string): Promise<void> {
    setStarting(true)
    try {
      let sid: string
      try {
        sid = (await api.createSession(pid, {})).sessionId
      } catch (err) {
        setInput(prompt)
        appendAssistant(`\n${t('chat.errorMessage', { message: (err as Error).message })}\n`)
        return
      }
      freshSids.add(sid)
      const did = attachments.draftId() ?? undefined
      // Register the deferred BEFORE the selection effect subscribes, so the
      // `ready` event cannot land between subscribe and await.
      const ready = waitForSubscription(sid)
      resetParts([{ kind: 'text', role: 'user', text: prompt }])
      historyGate.invalidate()
      displayedSid = sid
      displayedSpecId = undefined
      setRunningSids((prev) => ({ ...prev, [sid]: true }))
      setActiveSid(sid)
      await Promise.race([ready, delay(SUBSCRIBE_READY_TIMEOUT_MS)])
      try {
        await api.sendSessionMessage(pid, sid, prompt, did)
        attachments.reset()
      } catch (err) {
        appendAssistant(`\n${t('chat.errorMessage', { message: (err as Error).message })}\n`)
        setRunningSids((prev) => ({ ...prev, [sid]: false }))
      }
      void refetchSessions()
    } finally {
      setStarting(false)
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

  /**
   * Editing keeps the scope fixed, and there is nothing to choose without a
   * project. Both cases render read-only text instead of a disabled control:
   * the radio control selects on click without consulting its disabled state,
   * so a "locked" radio would still be switchable — and Tailwind's `disabled:`
   * variant never matches it (it is a div), so the lock would also be invisible.
   */
  function scopeSwitchable(): boolean {
    return editingCommandId() === null && Boolean(activeProjectId())
  }

  function resetCustomCommandForm(): void {
    setCustomCommandName('')
    setCustomCommandDescription('')
    setCustomCommandHiddenPrompt('')
    setCustomCommandPrefill('')
    // Default to the project: a command created from inside a project is
    // usually about that project, and the global scope is one click away.
    setCustomCommandScope(activeProjectId() ? 'project' : 'global')
    setCustomCommandError(null)
    setEditingCommandId(null)
  }

  function openCustomCommandDialog(): void {
    resetCustomCommandForm()
    setCustomCommandOpen(true)
  }

  function openEditCustomCommandDialog(command: SlashCommand): void {
    const id = command.customId
    const target = id ? customSlashCommands().find((cmd) => cmd.id === id) : undefined
    if (!target) return
    setEditingCommandId(target.id)
    setCustomCommandName(target.name)
    setCustomCommandDescription(target.description)
    setCustomCommandHiddenPrompt(target.hiddenPrompt)
    setCustomCommandPrefill(target.prefill)
    // Locked while editing: moving between scopes is a delete plus a create
    // across two stores, with no way to roll back a half-applied move.
    setCustomCommandScope(target.scope)
    setCustomCommandError(null)
    setCustomCommandOpen(true)
  }

  /**
   * Persisting hits the network, so the dialog stays open until it resolves —
   * closing on the optimistic path used to discard the error message set in the
   * rejection handler, leaving a silent failure.
   */
  async function saveCustomCommand(e: Event): Promise<void> {
    e.preventDefault()
    if (customCommandBusy()) return
    const name = normalizeSlashCommandName(customCommandName())
    if (!name) {
      setCustomCommandError(t('chat.customSlashCommandNameRequired'))
      return
    }
    if (!validSlashCommandName(name)) {
      setCustomCommandError(t('chat.customSlashCommandNameInvalid'))
      return
    }
    const existingId = editingCommandId()
    const projectId = activeProjectId() || ''
    const scope: SlashCommandScope =
      customCommandScope() === 'project' && projectId ? 'project' : 'global'
    const current =
      scope === 'project' ? projectInstructions(projectId) : globalConfig().customInstructions
    const existing = existingId ? current.find((cmd) => cmd.id === existingId) : undefined
    const nextCommand: CustomInstruction = {
      id: existing?.id ?? makeCustomSlashCommandId(),
      name,
      description: customCommandDescription().trim(),
      hiddenPrompt: customCommandHiddenPrompt().trim(),
      // Deliberately not trimmed: a trailing space lets the user keep typing
      // right after the prefill lands in the composer.
      prefill: customCommandPrefill(),
      createdAt: existing?.createdAt ?? Date.now(),
    }
    const next = [
      ...current.filter((cmd) => cmd.id !== nextCommand.id && cmd.name !== name),
      nextCommand,
    ]
    setCustomCommandBusy(true)
    try {
      if (scope === 'project') await saveProjectInstructions(projectId, next)
      else await saveCustomInstructions(next)
      setCustomCommandOpen(false)
      resetCustomCommandForm()
    } catch (err) {
      setCustomCommandError((err as Error).message)
    } finally {
      setCustomCommandBusy(false)
    }
  }

  async function confirmDeleteCustomSlashCommand(): Promise<void> {
    const id = deletingCommand()?.customId
    if (!id) return
    const target = customSlashCommands().find((cmd) => cmd.id === id)
    if (!target) return
    setDeleteCommandBusy(true)
    try {
      if (target.scope === 'project') {
        const projectId = activeProjectId() || ''
        await saveProjectInstructions(
          projectId,
          projectInstructions(projectId).filter((cmd) => cmd.id !== id),
        )
      } else {
        await saveCustomInstructions(
          globalConfig().customInstructions.filter((cmd) => cmd.id !== id),
        )
      }
      setDeletingCommand(null)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeleteCommandBusy(false)
    }
  }

  return (
    <aside
      class={`relative flex flex-col border-r bg-background text-base shrink-0 ${
        isCollapsed() ? 'w-9 transition-[width] duration-150' : ''
      }`}
      style={isCollapsed() ? undefined : { width: `${width()}px` }}
    >
      <header
        class={`flex items-center border-b ${
          isCollapsed() ? 'justify-center py-2' : 'justify-between px-2.5 py-2'
        }`}
      >
        <Show
          when={!isCollapsed()}
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
          {/* Session actions live next to Send/Abort now — the header only collapses. */}
          <Button
            variant="outline"
            size="sm"
            class="h-7 w-7 p-0"
            onClick={toggle}
            title={t('chat.collapse')}
          >
            <ChevronsLeft class="h-4 w-4" />
          </Button>
        </Show>
      </header>

      <Show when={!isCollapsed()}>
        <div class="flex min-h-0 flex-1 flex-col">
          {/* Rendered whenever a project is open — even with zero visible sessions,
              the user needs the height control to widen the list. */}
          <Show when={activeProjectId()}>
            <Card class="m-2 rounded-lg shadow-none">
              <Collapsible open={listOpen()} onOpenChange={toggleList}>
                {/* Hand-rolled trigger row: the radio group is interactive and
                    must not nest inside CollapsibleTrigger's <button>. */}
                <div class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5">
                  <button
                    type="button"
                    class="min-w-0 flex-1 text-left font-medium"
                    title={listOpen() ? t('chat.collapseSessions') : t('chat.expandSessions')}
                    onClick={() => toggleList(!listOpen())}
                  >
                    <Show
                      when={runningCount() > 0}
                      fallback={<span>{t('chat.sessionsLabelPlain')}</span>}
                    >
                      <span>{t('chat.sessionsLabel', { count: runningCount() })}</span>
                    </Show>
                  </button>
                  <RadioGroup
                    class="flex shrink-0 items-center gap-2"
                    value={String(sessionListRows())}
                    onChange={changeSessionListRows}
                    aria-label={t('chat.sessionListRows')}
                  >
                    <For each={SESSION_LIST_ROW_OPTIONS}>
                      {(rows) => (
                        <RadioGroupItem value={String(rows)} class="flex items-center gap-1">
                          <RadioGroupItemInput />
                          <RadioGroupItemControl class="h-3 w-3" />
                          <RadioGroupItemLabel class="cursor-pointer text-xs text-muted-foreground">
                            {sessionListRowsLabel(rows)}
                          </RadioGroupItemLabel>
                        </RadioGroupItem>
                      )}
                    </For>
                  </RadioGroup>
                  <button
                    type="button"
                    class="shrink-0"
                    title={listOpen() ? t('chat.collapseSessions') : t('chat.expandSessions')}
                    onClick={() => toggleList(!listOpen())}
                  >
                    <ChevronDown
                      class={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
                        listOpen() ? '' : '-rotate-90'
                      }`}
                    />
                  </button>
                </div>
                <CollapsibleContent>
                  <ul
                    class="m-0 list-none overflow-y-auto border-t py-1"
                    style={{ 'max-height': `${sessionListRows() * SESSION_ROW_HEIGHT_PX + 4}px` }}
                  >
                    <Show
                      when={visibleGroups().length > 0}
                      fallback={
                        <li class="px-2.5 py-1.5 text-xs text-muted-foreground">
                          {t('chat.noRunningSessions')}
                        </li>
                      }
                    >
                      <For each={visibleGroups()}>
                        {(g: SessionGroup) => (
                          <li>
                            <button
                              type="button"
                              class={`flex w-full items-center gap-1 px-2 py-1 text-left text-sm ${
                                activeGroup()?.key === g.key
                                  ? 'bg-primary-soft font-semibold'
                                  : 'hover:bg-accent'
                              }`}
                              title={
                                g.running
                                  ? t('chat.sessionTitleRunning', {
                                      kind: g.latest.kind,
                                      id: g.latest.id,
                                    })
                                  : t('chat.sessionTitle', { kind: g.latest.kind, id: g.latest.id })
                              }
                              // Clicking a spec row lands on its most recent
                              // round; the message area then shows all of them.
                              onClick={() => selectSession(g.latest.id)}
                            >
                              <Show when={g.running}>
                                <Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                              </Show>
                              <span class="shrink-0 text-xs text-muted-foreground">
                                [{g.latest.kind}]
                              </span>
                              <span class="min-w-0 flex-1 truncate">
                                {displaySessionTitle(g.latest)}
                              </span>
                              <Show when={g.sessions.length > 1}>
                                <span class="shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground">
                                  ×{g.sessions.length}
                                </span>
                              </Show>
                              <span
                                class="ml-auto max-w-20 shrink-0 truncate pl-2 text-right text-[11px] font-normal tabular-nums text-muted-foreground"
                                title={exactSessionUpdatedAt(g.updatedAt)}
                              >
                                {formatSessionUpdatedAt(g.updatedAt)}
                              </span>
                            </button>
                          </li>
                        )}
                      </For>
                    </Show>
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </Show>

          <div
            ref={messagesEl}
            class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2 pt-0 pr-1 mr-1 "
            onClick={onMessagesClick}
            onKeyDown={onMessagesKeyDown}
            onScroll={onMessagesScroll}
          >
            <Show
              when={blocks().length > 0}
              fallback={
                <div class="text-muted-foreground">
                  <p class="m-0">{activeSid() ? t('chat.empty') : t('chat.draftEmpty')}</p>
                  <Show when={!activeSid() && usageSummary()}>
                    {(summary) => <p class="mt-1 text-sm">{summary()}</p>}
                  </Show>
                </div>
              }
            >
              <For each={blocks()}>
                {(block) => (
                  <Show
                    when={block.kind === 'divider' ? block : null}
                    fallback={
                      <Show
                        when={block.kind === 'context' ? block : null}
                        fallback={
                          <Show
                            when={block.kind === 'assistant' ? block : null}
                            fallback={
                              // User input is NOT markdown: it routinely carries `@paths`,
                              // indentation and bare `*`/`_` that md would rewrite.
                              //
                              // Tinted with `primary` rather than a plain surface color —
                              // the two bubbles were once within 2% lightness of each other
                              // and read as one blob. What you said now separates at a
                              // glance from what the agent replied.
                              <div class="mb-2 whitespace-pre-wrap rounded border border-primary/20 border-l-2 border-l-primary bg-primary/10 px-2 py-1.5 font-medium text-foreground [overflow-wrap:anywhere]">
                                {(block as { text: string }).text}
                              </div>
                            }
                          >
                            {(assistant) => (
                              // `bg-card` (the panel's brightest surface) rather than
                              // `bg-muted`, which was *darker* than the rail it sat on and
                              // dragged body-text contrast down. The border carries the
                              // bubble's edge now that the fill barely differs from the rail.
                              <div class="mb-2 min-w-0 rounded border bg-card px-2 py-1.5 [overflow-wrap:anywhere]">
                                <For each={assistant().segments}>
                                  {(seg) => (
                                    <Show
                                      when={seg.kind === 'tools' ? seg : null}
                                      fallback={
                                        <div
                                          class="markdown chat-md"
                                          // eslint-disable-next-line solid/no-innerhtml -- renderMarkdown escapes all raw HTML outside a details/summary whitelist
                                          innerHTML={renderMarkdown(
                                            (seg as { text: string }).text,
                                            {
                                              mermaid: 'code',
                                              fileLinks: 'copy',
                                              fileLinkTitle: t('chat.copyFilePath'),
                                            },
                                          )}
                                        />
                                      }
                                    >
                                      {(tools) => <ChatToolBlock tools={tools().tools} />}
                                    </Show>
                                  )}
                                </For>
                              </div>
                            )}
                          </Show>
                        }
                      >
                        {(context) => <ChatContextBlock contexts={context().contexts} />}
                      </Show>
                    }
                  >
                    {(divider) => (
                      // Boundary between two rounds of the same spec. Deliberately
                      // the lightest element in the scroll: it separates, it does
                      // not compete with the bubbles on either side.
                      <div class="my-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span class="h-px flex-1 bg-border" />
                        <span class="shrink-0 tabular-nums">
                          {t('chat.sessionDivider', {
                            kind: divider().agentKind,
                            time: exactSessionUpdatedAt(divider().startedAt),
                          })}
                        </span>
                        <span class="h-px flex-1 bg-border" />
                      </div>
                    )}
                  </Show>
                )}
              </For>
            </Show>
          </div>

          <div class="border-t p-2">
            <Show when={attachments.count() > 0}>
              <div class="mb-1.5">
                <AttachmentList ctrl={attachments} compact />
              </div>
            </Show>
            <Show when={attachments.error()}>
              <p class="mb-1 text-xs text-destructive">{attachments.error()}</p>
            </Show>
            {/* Attachment button sits inline to the right of the textarea, vertically
                centered against it — not down in the action row. */}
            <div class="mb-1 flex items-center gap-1">
              <MentionTextarea
                projectId={activeProjectId() || ''}
                value={input()}
                onValueChange={setInput}
                slashCommands={slashCommands()}
                slashEmptyLabel={t('chat.slashCommandNoMatch')}
                onSlashCommandAction={openCustomCommandDialog}
                onEditSlashCommand={openEditCustomCommandDialog}
                onDeleteSlashCommand={setDeletingCommand}
                onKeyDown={onKeyDown}
                onPaste={attachments.onPaste}
                placeholder={
                  !activeProjectId()
                    ? t('chat.noSessionPlaceholder')
                    : activeSid()
                      ? t('chat.inputPlaceholder')
                      : t('chat.draftPlaceholder')
                }
                disabled={!activeProjectId()}
                minRows={2}
                maxRows={10}
                class="min-w-0 flex-1 bg-background px-2 py-1"
              />
              <Button
                variant="outline"
                size="sm"
                class="h-8 w-8 shrink-0 p-0"
                onClick={() => fileInputEl?.click()}
                disabled={!activeProjectId() || attachments.count() >= MAX_COUNT}
                title={t('newSpec.importAttachment')}
              >
                <Paperclip class="h-4 w-4" />
              </Button>
              <input
                ref={fileInputEl}
                type="file"
                accept={ACCEPT_MIME}
                multiple
                hidden
                onChange={attachments.onFileInputChange}
              />
            </div>
            <div class="flex items-center justify-end gap-1">
              <Button
                variant="outline"
                size="sm"
                class="h-8 w-8 p-0"
                onClick={newSession}
                disabled={!activeProjectId() || !activeSid()}
                title={t('chat.newSession')}
              >
                <Plus class="h-4 w-4" />
              </Button>
              {/* Strictly exclusive: a run shows Abort, everything else shows Send. */}
              <Show
                when={activeRunning()}
                fallback={
                  <Button
                    size="sm"
                    onClick={() => void send()}
                    disabled={
                      !activeProjectId() ||
                      !input().trim() ||
                      starting() ||
                      attachments.hasPending()
                    }
                  >
                    <Send class="mr-1 h-3.5 w-3.5" />
                    {t('chat.send')}
                  </Button>
                }
              >
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
            </div>
          </div>
        </div>
      </Show>

      <Show when={!isCollapsed()}>
        <div
          class="absolute right-0 top-0 z-[2] h-full w-1 cursor-col-resize bg-transparent hover:bg-accent/40"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={beginResize}
        />
      </Show>

      <Dialog
        open={customCommandOpen()}
        onOpenChange={(open) => {
          if (!open && customCommandBusy()) return
          setCustomCommandOpen(open)
          if (!open) resetCustomCommandForm()
        }}
      >
        <DialogContent class="max-w-[700px]">
          <DialogHeader>
            <DialogTitle>
              {editingCommandId()
                ? t('chat.editSlashCommandTitle')
                : t('chat.addSlashCommandTitle')}
            </DialogTitle>
          </DialogHeader>
          <form class="flex flex-col gap-4" onSubmit={(e) => void saveCustomCommand(e)}>
            <div class="flex flex-col gap-1 font-medium">
              {t('chat.customSlashCommandScope')}
              <Show
                when={scopeSwitchable()}
                fallback={
                  <span class="text-sm font-normal text-muted-foreground">
                    {customCommandScope() === 'project'
                      ? t('chat.slashCommandScopeProject')
                      : t('chat.slashCommandScopeGlobal')}
                  </span>
                }
              >
                <RadioGroup
                  value={customCommandScope()}
                  onChange={(v) => setCustomCommandScope(v as SlashCommandScope)}
                  class="flex items-center gap-4"
                >
                  <For
                    each={
                      [
                        { value: 'project', label: t('chat.slashCommandScopeProject') },
                        { value: 'global', label: t('chat.slashCommandScopeGlobal') },
                      ] as const
                    }
                  >
                    {(option) => (
                      <RadioGroupItem value={option.value} class="flex items-center gap-1">
                        <RadioGroupItemInput />
                        <RadioGroupItemControl class="h-3 w-3" />
                        <RadioGroupItemLabel class="cursor-pointer text-sm font-normal">
                          {option.label}
                        </RadioGroupItemLabel>
                      </RadioGroupItem>
                    )}
                  </For>
                </RadioGroup>
              </Show>
              <span class="text-xs font-normal text-muted-foreground">
                {customCommandScope() === 'project'
                  ? t('chat.customSlashCommandScopeProjectHint')
                  : t('chat.customSlashCommandScopeGlobalHint')}
              </span>
            </div>
            <label class="flex flex-col gap-1 font-medium" for="chat-custom-command-name">
              {t('chat.customSlashCommandName')}
              <Input
                id="chat-custom-command-name"
                value={customCommandName()}
                placeholder={t('chat.customSlashCommandNamePlaceholder')}
                onInput={(e) => {
                  setCustomCommandName(e.currentTarget.value)
                  setCustomCommandError(null)
                }}
                required
              />
            </label>
            <label class="flex flex-col gap-1 font-medium" for="chat-custom-command-description">
              {t('chat.customSlashCommandDescription')}
              <Input
                id="chat-custom-command-description"
                value={customCommandDescription()}
                placeholder={t('chat.customSlashCommandDescriptionPlaceholder')}
                onInput={(e) => setCustomCommandDescription(e.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1 font-medium" for="chat-custom-command-hidden-prompt">
              {t('chat.customSlashCommandHiddenPrompt')}
              <AutoResizeTextarea
                id="chat-custom-command-hidden-prompt"
                value={customCommandHiddenPrompt()}
                placeholder={t('chat.customSlashCommandHiddenPromptPlaceholder')}
                minRows={PROMPT_MIN_ROWS}
                maxRows={PROMPT_MAX_ROWS}
                onInput={(e) => setCustomCommandHiddenPrompt(e.currentTarget.value)}
              />
              <span class="text-xs font-normal text-muted-foreground">
                {t('chat.customSlashCommandHiddenPromptHint')}
              </span>
            </label>
            <label class="flex flex-col gap-1 font-medium" for="chat-custom-command-prefill">
              {t('chat.customSlashCommandPrefill')}
              <AutoResizeTextarea
                id="chat-custom-command-prefill"
                value={customCommandPrefill()}
                placeholder={t('chat.customSlashCommandPrefillPlaceholder')}
                minRows={PROMPT_MIN_ROWS}
                maxRows={PROMPT_MAX_ROWS}
                onInput={(e) => setCustomCommandPrefill(e.currentTarget.value)}
              />
              <span class="text-xs font-normal text-muted-foreground">
                {t('chat.customSlashCommandPrefillHint')}
              </span>
            </label>
            <Show when={customCommandError()}>
              <p class="m-0 text-sm text-destructive">{customCommandError()}</p>
            </Show>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCustomCommandOpen(false)}
                disabled={customCommandBusy()}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!customCommandName().trim() || customCommandBusy()}>
                {customCommandBusy() ? t('common.saving') : t('chat.saveCustomSlashCommand')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deletingCommand() !== null}
        onOpenChange={(o) => !o && !deleteCommandBusy() && setDeletingCommand(null)}
      >
        <DialogContent class="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('chat.deleteSlashCommandTitle')}</DialogTitle>
            <DialogDescription>
              {t('chat.deleteSlashCommandConfirm', {
                name: normalizeSlashCommandName(deletingCommand()?.value ?? ''),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingCommand(null)}
              disabled={deleteCommandBusy()}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDeleteCustomSlashCommand()}
              disabled={deleteCommandBusy()}
            >
              {deleteCommandBusy() ? t('common.deleting') : t('common.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
