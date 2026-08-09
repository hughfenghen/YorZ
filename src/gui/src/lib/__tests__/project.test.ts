import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRequestedChatSession,
  requestedChatSessionId,
  requestChatSession,
} from '../chat-session-request.js'
import {
  canMergeWorktree,
  createWorktreeMergeGuard,
  hasRunningProjectTasks,
} from '../worktree-merge.js'

describe('chat session switch requests', () => {
  beforeEach(() => {
    clearRequestedChatSession()
  })

  it('can be cleared after ChatPanel consumes a switch request', () => {
    requestChatSession('sid-a')
    expect(requestedChatSessionId()).toBe('sid-a')

    clearRequestedChatSession()
    expect(requestedChatSessionId()).toBe('')

    requestChatSession('sid-a')
    expect(requestedChatSessionId()).toBe('sid-a')
  })
})

describe('worktree merge activity guard', () => {
  it('blocks merge for either a running command or an active Agent turn', () => {
    expect(hasRunningProjectTasks([{ status: 'running' }], [])).toBe(true)
    expect(hasRunningProjectTasks([{ status: 'exited' }], [{ running: true }])).toBe(true)
    expect(hasRunningProjectTasks([{ status: 'killed' }], [{ running: false }])).toBe(false)
  })

  it('reads the latest project activity before allowing a merge', async () => {
    const allowed = await canMergeWorktree('project-a', {
      listCommandRuns: async () => [{ status: 'exited' }],
      listSessions: async () => [{ running: true }],
    })

    expect(allowed).toBe(false)
  })

  it('does not call merge when activity is running or the activity check fails', async () => {
    let mergeCalls = 0
    const runningGuard = createWorktreeMergeGuard({
      listCommandRuns: async () => [{ status: 'running' }],
      listSessions: async () => [],
    })

    expect(
      await runningGuard.merge('project-a', async () => {
        mergeCalls += 1
        return 'merged'
      }),
    ).toEqual({ status: 'blocked', reason: 'running' })

    const failingGuard = createWorktreeMergeGuard({
      listCommandRuns: async () => {
        throw new Error('activity unavailable')
      },
      listSessions: async () => [],
    })
    await expect(
      failingGuard.merge('project-a', async () => {
        mergeCalls += 1
        return 'merged'
      }),
    ).rejects.toThrow('activity unavailable')
    expect(mergeCalls).toBe(0)
  })

  it('blocks a repeated merge while the first activity check is pending', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let mergeCalls = 0
    const guard = createWorktreeMergeGuard({
      listCommandRuns: async () => {
        await pending
        return []
      },
      listSessions: async () => [],
    })
    const first = guard.merge('project-a', async () => {
      mergeCalls += 1
      return 'merged'
    })
    await Promise.resolve()

    expect(await guard.merge('project-a', async () => 'duplicate')).toEqual({
      status: 'blocked',
      reason: 'busy',
    })
    release()
    expect(await first).toEqual({ status: 'merged', value: 'merged' })
    expect(mergeCalls).toBe(1)
  })
})
