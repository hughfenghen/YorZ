import { describe, expect, it } from 'vitest'
import { createSpecsRoutes } from '../routes/specs.js'
import type { ProjectInstance } from '../project-registry.js'
import type { SpecListItem } from '../spec-store.js'
import type { AgentEvent } from '../agent-sdk/types.js'

function spec(id: string, summary: string): SpecListItem {
  return {
    id,
    title: id,
    stage: 'plan',
    updated_at: '2026-08-03 10:00:00',
    summary,
    mtime: Date.now(),
  }
}

function makeProject(initial: SpecListItem[]) {
  let items = [...initial]
  let doneCb: ((sessionId: string) => void) | undefined
  const bound: Array<{ sessionId: string; specId: string; title?: string }> = []
  const project = {
    store: {
      list: async () => [...items],
    },
    sessions: {
      createSession: async () => ({ sessionId: 'draft-session', kind: 'claude' }),
      send: async () => ({
        runId: 'run-1',
        sessionId: 'draft-session',
        onEvent: (_cb: (ev: AgentEvent) => void) => () => {},
        onDone: (cb: (sessionId: string) => void) => {
          doneCb = cb
          return () => {
            doneCb = undefined
          }
        },
      }),
      bindSessionToSpec: async (sessionId: string, specId: string, title?: string) => {
        bound.push({ sessionId, specId, title })
        return true
      },
    },
  } as unknown as ProjectInstance

  return {
    project,
    bound,
    setItems: (next: SpecListItem[]) => {
      items = next
    },
    finish: async (sessionId = 'draft-session') => {
      doneCb?.(sessionId)
      await new Promise((r) => setTimeout(r, 0))
    },
  }
}

describe('draft spec session binding', () => {
  it('binds the draft session to the single spec created by the agent', async () => {
    const before = [spec('260801.feat.old', 'old')]
    const fake = makeProject(before)
    const app = createSpecsRoutes(async () => fake.project)

    const res = await app.request('/projects/p/specs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'feat', requirement: '复用新建 spec 的 session' }),
    })
    expect(res.status).toBe(202)

    fake.setItems([
      ...before,
      spec('260803.feat.reuse-spec-agent-session', '复用新建 spec session'),
    ])
    await fake.finish('real-session')

    expect(fake.bound).toEqual([
      {
        sessionId: 'real-session',
        specId: '260803.feat.reuse-spec-agent-session',
        title: '260803.feat.reuse-spec-agent-session · 复用新建 spec session',
      },
    ])
  })

  it('does not bind when multiple new specs appear before the draft run completes', async () => {
    const before = [spec('260801.feat.old', 'old')]
    const fake = makeProject(before)
    const app = createSpecsRoutes(async () => fake.project)

    const res = await app.request('/projects/p/specs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'feat', requirement: '复用新建 spec 的 session' }),
    })
    expect(res.status).toBe(202)

    fake.setItems([...before, spec('260803.feat.a', 'a'), spec('260803.feat.b', 'b')])
    await fake.finish()

    expect(fake.bound).toEqual([])
  })
})
