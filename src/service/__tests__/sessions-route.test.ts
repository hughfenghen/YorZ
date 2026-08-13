import { describe, expect, it } from 'vitest'
import { createSessionsRoutes } from '../routes/sessions.js'

describe('sessions routes', () => {
  it('GET /projects/:projectId/agent-usage returns structured usage status', async () => {
    const app = createSessionsRoutes(async (id) =>
      id === 'p1'
        ? ({
            sessions: {
              getUsageStatus: async () => ({
                kind: 'claude',
                status: 'available',
                checkedAt: 123,
                rateLimitsAvailable: true,
                windows: [{ key: 'five_hour', label: '5-hour', utilization: 55, resetsAt: null }],
              }),
            },
          } as never)
        : null,
    )

    const res = await app.request('/projects/p1/agent-usage')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      kind: 'claude',
      status: 'available',
      checkedAt: 123,
      windows: [{ key: 'five_hour', utilization: 55 }],
    })
  })
})
