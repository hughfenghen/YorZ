import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.js', import.meta.url))

let handle: ServeHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
  delete process.env.YORZ_AGENT_CMD
})

async function startInTmp() {
  process.env.YORZ_AGENT_CMD = `${process.execPath} ${FAKE_CLAUDE}`
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-review-'))
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-review-cfg-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'config.json') })
  const list = await handle.registry.list()
  const projectId = list[0]!.id
  return {
    cwd,
    apiPrefix: `${handle.url}api/projects/${projectId}`,
  }
}

async function createSpec(apiPrefix: string, title = 'Sample'): Promise<string> {
  const res = await fetch(`${apiPrefix}/specs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, type: 'feat', summary: 't' }),
  })
  const body = (await res.json()) as { id: string }
  return body.id
}

describe('POST /specs/:id/git', () => {
  it('400 when action is missing or invalid', async () => {
    const { apiPrefix } = await startInTmp()
    const id = await createSpec(apiPrefix)
    const noBody = await fetch(`${apiPrefix}/specs/${id}/git`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(noBody.status).toBe(400)

    const bogus = await fetch(`${apiPrefix}/specs/${id}/git`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'push' }),
    })
    expect(bogus.status).toBe(400)
  })

  it('accepts a valid git action and returns {runId}', async () => {
    const { apiPrefix } = await startInTmp()
    const id = await createSpec(apiPrefix)
    const res = await fetch(`${apiPrefix}/specs/${id}/git`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'commit' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runId: string }
    expect(typeof body.runId).toBe('string')
    expect(body.runId.length).toBeGreaterThan(0)
  })

  it('404 for unknown spec', async () => {
    const { apiPrefix } = await startInTmp()
    const res = await fetch(`${apiPrefix}/specs/nope/git`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'commit' }),
    })
    expect(res.status).toBe(404)
  })

  it('400 when JSON body is invalid', async () => {
    const { apiPrefix } = await startInTmp()
    const id = await createSpec(apiPrefix)
    const res = await fetch(`${apiPrefix}/specs/${id}/git`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})
