import { describe, expect, it } from 'vitest'
import { createSpecReviewRoutes } from '../routes/spec-review.js'
import { createSpecsRoutes, SPEC_BUSY_ERROR, type ResolveProject } from '../routes/specs.js'

/**
 * Same-spec serialization.
 *
 * Rounds used to share one session, so a second dispatch queued behind the
 * first. Now that every system-driven round mints its own session, that implicit
 * lock is gone — and two agents editing one `spec.md` concurrently would
 * overwrite each other. These tests pin the guard that replaced it.
 */
describe('same-spec dispatch guard', () => {
  interface Stub {
    dispatched: string[]
    appended: number
    resolve: ResolveProject
  }

  function stub(running: boolean): Stub {
    const s: Stub = {
      dispatched: [],
      appended: 0,
      resolve: async () => null,
    }
    const project = {
      path: '/tmp/yorz-guard',
      specsDir: '/tmp/yorz-guard/.yorz/specs',
      specsDirRelative: '.yorz/specs',
      store: {
        // Shaped for `trackSpecStage`, which snapshots the spec around a dispatch.
        read: async () => ({ id: 'spec-a', frontmatter: { stage: 'execute' }, body: '- [ ] t' }),
        appendItem: async () => {
          s.appended += 1
        },
      },
      sessions: {
        isSpecRunning: async () => running,
        createSessionForSpec: async () => ({ sessionId: 'new-session', kind: 'claude' }),
        latestSessionForSpec: async () => ({ sessionId: 'latest-session', kind: 'claude' }),
        send: async (sid: string) => {
          s.dispatched.push(sid)
          return { runId: 'r1', sessionId: sid, onEvent: () => () => {}, onDone: () => () => {} }
        },
      },
    }
    s.resolve = async (id: string) => (id === 'p1' ? (project as never) : null)
    return s
  }

  const post = (app: ReturnType<typeof createSpecsRoutes>, path: string, body?: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })

  it('refuses a run while another round of the same spec is in flight', async () => {
    const s = stub(true)
    const res = await post(createSpecsRoutes(s.resolve), '/projects/p1/specs/spec-a/run')

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: SPEC_BUSY_ERROR })
    expect(s.dispatched).toEqual([])
  })

  it('refuses git-ops while another round of the same spec is in flight', async () => {
    const s = stub(true)
    const res = await post(
      createSpecReviewRoutes(s.resolve) as never,
      '/projects/p1/specs/spec-a/git',
      {
        action: 'commit',
      },
    )

    expect(res.status).toBe(409)
    expect(s.dispatched).toEqual([])
  })

  it('keeps an append while the spec is busy, but skips the dispatch', async () => {
    const s = stub(true)
    const res = await post(createSpecsRoutes(s.resolve), '/projects/p1/specs/spec-a/appends', {
      kind: 'fix',
      description: 'x',
    })

    // Not an error: reporting a failure would invite the user to resubmit and
    // duplicate the item that was already written to the md.
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, busy: true })
    expect(s.appended).toBe(1)
    expect(s.dispatched).toEqual([])
  })

  it('dispatches a run on a fresh session when the spec is idle', async () => {
    const s = stub(false)
    const res = await post(createSpecsRoutes(s.resolve), '/projects/p1/specs/spec-a/run')

    expect(res.status).toBe(200)
    expect(s.dispatched).toEqual(['new-session'])
  })

  it('dispatches explain on the spec latest session, not a fresh one', async () => {
    const s = stub(false)
    const res = await post(createSpecsRoutes(s.resolve), '/projects/p1/specs/spec-a/explain', {
      text: '解释这段',
    })

    expect(res.status).toBe(200)
    expect(s.dispatched).toEqual(['latest-session'])
  })
})
