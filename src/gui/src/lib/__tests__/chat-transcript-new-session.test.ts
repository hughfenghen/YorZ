// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, createSignal } from 'solid-js'
import type { SessionEvent } from '@shared/api/sse.js'

const createSession = vi.fn<
  (
    pid: string,
    body: { groupFromSessionId: string },
  ) => Promise<{
    sessionId: string
    kind: 'claude'
  }>
>()
const sendSessionMessage = vi.fn(
  async (_pid: string, _sid: string, _prompt: string, _draftId?: string) => ({
    runId: 'r1',
    sessionId: 's2',
  }),
)
const getSessionGroupMessages = vi.fn(async (_pid: string, _groupId: string) => [
  {
    sessionId: 's1',
    kind: 'claude' as const,
    createdAt: 1,
    messages: [
      {
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'old answer' }],
      },
    ],
  },
])

vi.mock('@shared/api/index.js', () => ({
  api: {
    createSession: (pid: string, body: { groupFromSessionId: string }) => createSession(pid, body),
    sendSessionMessage: (pid: string, sid: string, prompt: string, draftId?: string) =>
      sendSessionMessage(pid, sid, prompt, draftId),
    getSessionGroupMessages: (pid: string, groupId: string) =>
      getSessionGroupMessages(pid, groupId),
    getSessionMessages: async () => [],
    getSpecMessages: async () => [],
  },
}))

vi.mock('@shared/api/sse.js', () => ({
  subscribeSession: (
    _pid: string,
    _sid: string,
    handlers: { onReady?: () => void; onEvent: (event: SessionEvent) => void },
  ) => {
    handlers.onReady?.()
    return () => {}
  },
}))

const { createChatTranscript } = await import('@shared/lib/chat-transcript.js')
const tick = () => new Promise((resolve) => window.setTimeout(resolve, 20))

function mount() {
  return createRoot((dispose) => {
    const [sid, setSid] = createSignal('s1')
    const [running, setRunning] = createSignal(false)
    const sessionsChanged = vi.fn()
    const tx = createChatTranscript({
      projectId: () => 'p1',
      sessionId: sid,
      specId: () => undefined,
      groupId: () => 'g1',
      running,
      known: () => true,
      listPending: () => false,
      onSessionIdChange: setSid,
      onRunningChange: (changed, value) => {
        if (changed === sid()) setRunning(value)
      },
      onSessionsChanged: sessionsChanged,
      errorLabel: (message) => `[Error] ${message}`,
    })
    const snapshot = () =>
      tx.blocks().map((block) => {
        if (block.kind === 'divider') return `divider:${block.sessionId}`
        if (block.kind === 'user') return `user:${block.text}`
        if (block.kind === 'assistant') {
          return `assistant:${block.segments
            .map((segment) => (segment.kind === 'text' ? segment.text : ''))
            .join('')}`
        }
        return block.kind
      })
    return { tx, sid, sessionsChanged, snapshot, dispose }
  })
}

beforeEach(() => {
  createSession.mockReset()
  createSession.mockResolvedValue({ sessionId: 's2', kind: 'claude' })
  sendSessionMessage.mockClear()
  getSessionGroupMessages.mockClear()
})

describe('createChatTranscript.sendInNewSession', () => {
  it('shows one pending divider immediately for a bare /new without creating a session', async () => {
    const host = mount()
    try {
      await tick()
      host.tx.beginNewSessionBoundary('claude')

      expect(host.snapshot()).toEqual([
        'assistant:old answer',
        'divider:__pending-new-session__:s1',
      ])
      expect(createSession).not.toHaveBeenCalled()

      host.tx.beginNewSessionBoundary('claude')
      expect(host.snapshot()).toEqual([
        'assistant:old answer',
        'divider:__pending-new-session__:s1',
      ])
    } finally {
      host.dispose()
    }
  })

  it('replaces the pending divider, switches session, and sends without duplicating it', async () => {
    const host = mount()
    try {
      await tick()
      expect(host.snapshot()).toEqual(['assistant:old answer'])
      host.tx.beginNewSessionBoundary('claude')

      await expect(host.tx.sendInNewSession('new question')).resolves.toBe('sent')

      expect(createSession).toHaveBeenCalledWith('p1', { groupFromSessionId: 's1' })
      expect(sendSessionMessage).toHaveBeenCalledWith('p1', 's2', 'new question', undefined)
      expect(host.sid()).toBe('s2')
      expect(host.snapshot()).toEqual(['assistant:old answer', 'divider:s2', 'user:new question'])
      expect(host.sessionsChanged).toHaveBeenCalledOnce()
    } finally {
      host.dispose()
    }
  })

  it('keeps the current session when same-group creation fails', async () => {
    createSession.mockRejectedValueOnce(new Error('cannot create'))
    const host = mount()
    try {
      await tick()
      host.tx.beginNewSessionBoundary('claude')

      await expect(host.tx.sendInNewSession('new question')).resolves.toBe('not-started')

      expect(host.sid()).toBe('s1')
      expect(host.snapshot().join('\n')).toContain('old answer')
      expect(host.snapshot()).toContain('divider:__pending-new-session__:s1')
      expect(sendSessionMessage).not.toHaveBeenCalled()
    } finally {
      host.dispose()
    }
  })
})
