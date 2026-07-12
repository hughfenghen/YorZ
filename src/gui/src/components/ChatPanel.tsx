import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js'
import { ChevronsRight, ChevronsLeft, Plus, Send, Square } from 'lucide-solid'
import { api, type SessionInfo, type SessionMessage } from '../lib/api.js'
import { subscribeSession, type SessionEvent } from '../lib/sse.js'
import { activeProjectId, requestedChatSessionId } from '../lib/project.js'
import { Button } from './ui/button.jsx'

const COLLAPSED_KEY = 'yorz.layout.col2.collapsed'
const WIDTH_KEY = 'yorz.layout.col2.width'
const DEFAULT_WIDTH = 340
const MIN_WIDTH = 260
const MAX_WIDTH = 640

function clampWidth(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)))
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
      if (p.type === 'tool-use') return `\n[tool] ${p.name}\n`
      return ''
    })
    .join('')
  return { role: m.role, text }
}

export const ChatPanel: Component = () => {
  const [collapsed, setCollapsed] = createSignal(readLocal(COLLAPSED_KEY, '0') === '1')
  const [width, setWidth] = createSignal(clampWidth(Number(readLocal(WIDTH_KEY, String(DEFAULT_WIDTH)))))
  const [activeSid, setActiveSid] = createSignal<string>('')
  const [entries, setEntries] = createSignal<ChatEntry[]>([])
  const [input, setInput] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  const [sessions, { refetch: refetchSessions }] = createResource(
    () => activeProjectId() || undefined,
    (pid) => api.listSessions(pid),
  )

  // A spec page requested that Chat switch to a specific (per-spec) session.
  createEffect(() => {
    const sid = requestedChatSessionId()
    if (!sid || sid === activeSid()) return
    setActiveSid(sid)
    if (collapsed()) {
      setCollapsed(false)
      writeLocal(COLLAPSED_KEY, '0')
    }
    void refetchSessions()
  })

  function toggle() {
    const next = !collapsed()
    setCollapsed(next)
    writeLocal(COLLAPSED_KEY, next ? '1' : '0')
  }

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
        else if (ev.type === 'tool-use') appendAssistant(`\n[tool] ${ev.name}\n`)
        else if (ev.type === 'turn-completed') setBusy(false)
        else if (ev.type === 'error') {
          appendAssistant(`\n[error] ${ev.message}\n`)
          setBusy(false)
        } else if (ev.type === 'session-started' && ev.sessionId !== sid) {
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
      await refetchSessions()
      setActiveSid(sessionId)
    } catch {
      // surfaced via list refresh failure; keep silent
    }
  }

  async function send() {
    const pid = activeProjectId()
    const sid = activeSid()
    const prompt = input().trim()
    if (!pid || !sid || !prompt || busy()) return
    setInput('')
    setEntries((prev) => [...prev, { role: 'user', text: prompt }])
    setBusy(true)
    try {
      await api.sendSessionMessage(pid, sid, prompt)
    } catch (err) {
      appendAssistant(`\n[error] ${(err as Error).message}\n`)
      setBusy(false)
    }
  }

  async function abort() {
    const pid = activeProjectId()
    const sid = activeSid()
    if (!pid || !sid) return
    await api.abortSession(pid, sid).catch(() => {})
    setBusy(false)
  }

  function onKeyDown(e: KeyboardEvent) {
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
            <Button variant="outline" size="sm" class="h-7 w-7 p-0" onClick={toggle} title="展开 Chat">
              <ChevronsRight class="h-4 w-4" />
            </Button>
          }
        >
          <span class="font-semibold tracking-wide">Chat</span>
          <div class="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              class="h-7 w-7 p-0"
              onClick={() => void newSession()}
              title="新建会话"
            >
              <Plus class="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" class="h-7 w-7 p-0" onClick={toggle} title="折叠 Chat">
              <ChevronsLeft class="h-4 w-4" />
            </Button>
          </div>
        </Show>
      </header>

      <Show when={!collapsed()}>
        <div class="flex min-h-0 flex-1 flex-col">
          <Show when={(sessions() ?? []).length > 0}>
            <ul class="m-0 max-h-40 list-none overflow-y-auto border-b py-1">
              <For each={sessions() ?? []}>
                {(s: SessionInfo) => (
                  <li>
                    <button
                      type="button"
                      class={`w-full truncate px-2.5 py-1.5 text-left text-sm ${
                        activeSid() === s.id ? 'bg-background font-semibold' : 'hover:bg-background'
                      }`}
                      title={`${s.kind} · ${s.id}`}
                      onClick={() => setActiveSid(s.id)}
                    >
                      <span class="mr-1 text-xs text-muted-foreground">[{s.kind}]</span>
                      {s.title || s.id}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <div class="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
            <Show
              when={activeSid()}
              fallback={
                <p class="text-sm text-muted-foreground">选择或新建一个会话开始对话。</p>
              }
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
            <textarea
              class="mb-1 h-16 w-full resize-none rounded border bg-background px-2 py-1 text-sm outline-none"
              placeholder={activeSid() ? '输入消息，Enter 发送…' : '先新建会话'}
              value={input()}
              disabled={!activeSid()}
              onInput={(e) => setInput(e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            <div class="flex justify-end gap-1">
              <Show when={busy()}>
                <Button variant="outline" size="sm" onClick={() => void abort()} title="中止">
                  <Square class="mr-1 h-3.5 w-3.5" />
                  中止
                </Button>
              </Show>
              <Button
                size="sm"
                onClick={() => void send()}
                disabled={!activeSid() || !input().trim() || busy()}
              >
                <Send class="mr-1 h-3.5 w-3.5" />
                发送
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
