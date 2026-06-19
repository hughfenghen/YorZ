import { mkdtemp, readFile } from 'node:fs/promises'
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

async function startInTmp(opts?: { fakeAgent?: boolean }) {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-appends-route-'))
  if (opts?.fakeAgent) {
    process.env.YORZ_AGENT_CMD = `${process.execPath} ${FAKE_CLAUDE}`
  }
  handle = await start({ cwd, port: 0 })
  return { cwd, url: handle.url }
}

async function createSpec(url: string): Promise<string> {
  const res = await fetch(`${url}api/specs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'A', type: 'feat', summary: 'a' }),
  })
  const { id } = (await res.json()) as { id: string }
  return id
}

describe('POST /api/specs/:id/appends', () => {
  it('200 writes `## 追加任务` entry and returns runId when autoRun=true (default)', async () => {
    const { cwd, url } = await startInTmp({ fakeAgent: true })
    const id = await createSpec(url)
    const res = await fetch(`${url}api/specs/${id}/appends`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'fix', description: '登录失败无反馈' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; runId?: string }
    expect(body.ok).toBe(true)
    expect(body.runId).toBeTruthy()
    const raw = await readFile(join(cwd, '.yorz', 'specs', id, 'spec.md'), 'utf8')
    expect(raw).toContain('## 追加任务')
    expect(raw).toContain('[open] [fix]')
    expect(raw).toContain('登录失败无反馈')
    expect(raw).toContain('last_action: 追加任务（fix）')
  })

  it('200 with autoRun=false does not return runId', async () => {
    const { url } = await startInTmp()
    const id = await createSpec(url)
    const res = await fetch(`${url}api/specs/${id}/appends`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'feat', description: 'x', autoRun: false }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; runId?: string }
    expect(body.ok).toBe(true)
    expect(body.runId).toBeUndefined()
  })

  it('400 when kind is not feat/refct/fix', async () => {
    const { url } = await startInTmp()
    const id = await createSpec(url)
    const res = await fetch(`${url}api/specs/${id}/appends`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'bug', description: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('400 when description missing', async () => {
    const { url } = await startInTmp()
    const id = await createSpec(url)
    const res = await fetch(`${url}api/specs/${id}/appends`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'fix' }),
    })
    expect(res.status).toBe(400)
  })

  it('400 when description exceeds 4000 chars', async () => {
    const { url } = await startInTmp()
    const id = await createSpec(url)
    const res = await fetch(`${url}api/specs/${id}/appends`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'fix', description: 'x'.repeat(4001) }),
    })
    expect(res.status).toBe(400)
  })

  it('404 when spec does not exist', async () => {
    const { url } = await startInTmp()
    const res = await fetch(`${url}api/specs/does-not-exist/appends`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'fix', description: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  it('400 on invalid JSON', async () => {
    const { url } = await startInTmp()
    const id = await createSpec(url)
    const res = await fetch(`${url}api/specs/${id}/appends`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})
