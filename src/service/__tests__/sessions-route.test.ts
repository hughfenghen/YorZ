import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stripHiddenPrompt, type CustomInstruction } from '../custom-instruction.js'
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

describe('sessions routes — custom instruction scopes', () => {
  let projectPath: string
  let globalHome: string
  let sent: string[]
  const savedHome = process.env.YORZ_HOME

  function instruction(over: Partial<CustomInstruction> = {}): CustomInstruction {
    return {
      id: 'i-1',
      name: 'deploy',
      description: '',
      hiddenPrompt: '',
      prefill: '',
      createdAt: 1,
      ...over,
    }
  }

  async function writeProjectInstructions(list: CustomInstruction[]): Promise<void> {
    await mkdir(join(projectPath, '.yorz'), { recursive: true })
    await writeFile(
      join(projectPath, '.yorz/config.json'),
      JSON.stringify({ version: 1, customInstructions: list }, null, 2),
      'utf8',
    )
  }

  async function writeGlobalInstructions(list: CustomInstruction[]): Promise<void> {
    await writeFile(
      join(globalHome, 'config.json'),
      JSON.stringify({ version: 1, projects: [], customInstructions: list }, null, 2),
      'utf8',
    )
  }

  function app() {
    return createSessionsRoutes(
      async () =>
        ({
          path: projectPath,
          specsDirRelative: '.yorz/specs',
          attachments: {},
          sessions: {
            send: async (_sid: string, finalPrompt: string) => {
              sent.push(finalPrompt)
              return { runId: 'r1', sessionId: 's1' }
            },
          },
        }) as never,
    )
  }

  async function send(prompt: string): Promise<void> {
    const res = await app().request('/projects/p1/sessions/s1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    expect(res.status).toBe(202)
  }

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'yorz-sess-scope-'))
    globalHome = await mkdtemp(join(tmpdir(), 'yorz-sess-scope-home-'))
    process.env.YORZ_HOME = globalHome
    sent = []
  })

  afterEach(() => {
    if (savedHome === undefined) delete process.env.YORZ_HOME
    else process.env.YORZ_HOME = savedHome
  })

  it('injects the hidden prompt of a project-scoped instruction', async () => {
    await writeProjectInstructions([instruction({ hiddenPrompt: '按项目发布流程执行' })])
    await send('/deploy only web')
    expect(sent[0]).toContain('按项目发布流程执行')
    expect(stripHiddenPrompt(sent[0])).toBe('/deploy only web')
  })

  it('lets the project scope shadow a global instruction with the same name', async () => {
    await writeProjectInstructions([instruction({ id: 'p-1', hiddenPrompt: 'project body' })])
    await writeGlobalInstructions([instruction({ id: 'g-1', hiddenPrompt: 'global body' })])
    await send('/deploy')
    expect(sent[0]).toContain('project body')
    expect(sent[0]).not.toContain('global body')
  })

  it('still resolves global-only instructions', async () => {
    await writeProjectInstructions([])
    await writeGlobalInstructions([instruction({ name: 'review', hiddenPrompt: 'global review' })])
    await send('/review')
    expect(sent[0]).toContain('global review')
  })
})
