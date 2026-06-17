import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
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
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-service-'))
  if (opts?.fakeAgent) {
    process.env.YORZ_AGENT_CMD = `${process.execPath} ${FAKE_CLAUDE}`
  }
  handle = await start({ cwd, port: 0 })
  return { cwd, url: handle.url, port: handle.port }
}

describe('YorZ Service HTTP', () => {
  it('POST /api/specs creates spec and GET /api/specs lists it', async () => {
    const { url } = await startInTmp()
    const createRes = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Spec',
        type: 'feat',
        summary: 'a test spec',
        requirement: 'requirement body',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; path: string }
    expect(created.id).toMatch(/^\d{6}\.feat\./)

    const listRes = await fetch(`${url}api/specs`)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { id: string; title: string }[]
    expect(list.some((s) => s.id === created.id && s.title === 'Test Spec')).toBe(true)

    const detailRes = await fetch(`${url}api/specs/${created.id}`)
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as { frontmatter: { stage: string }; body: string }
    expect(detail.frontmatter.stage).toBe('plan')
    expect(detail.body).toContain('requirement body')
  })

  it('POST /api/specs with only type + requirement returns a draft runId (Agent-created)', async () => {
    const { url } = await startInTmp({ fakeAgent: true })
    const res = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'feat', requirement: '加上手机号登录支持' }),
    })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { runId?: string; draft?: boolean }
    expect(body.draft).toBe(true)
    expect(body.runId).toBeTruthy()
  })

  it('GET /api/runs/:runId/events streams stdout for a draft run', async () => {
    const { url } = await startInTmp({ fakeAgent: true })
    const created = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'feat', requirement: '加上手机号登录支持' }),
    })
    expect(created.status).toBe(202)
    const { runId } = (await created.json()) as { runId: string }

    const sseRes = await fetch(`${url}api/runs/${runId}/events`, {
      headers: { accept: 'text/event-stream' },
    })
    expect(sseRes.body).not.toBeNull()
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()
    const stdout = await readUntil(reader, decoder, (t) => t.includes('event: agent-stdout'), 4000)
    expect(stdout).toContain('received prompt')
    await reader.cancel()
  })

  it('GET /api/events/specs emits list-updated when a new spec lands externally', async () => {
    const { url, cwd } = await startInTmp()
    const sseRes = await fetch(`${url}api/events/specs`, {
      headers: { accept: 'text/event-stream' },
    })
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()
    await readUntil(reader, decoder, (t) => t.includes('event: ready'))

    // Self-writes via the SpecStore are suppressed by the watcher's echo guard;
    // simulate the real flow (Agent writes the file directly) by using fs.
    await new Promise((r) => setTimeout(r, 200))
    const { mkdir, writeFile } = await import('node:fs/promises')
    const dir = join(cwd, '.yorz', 'specs', '260614.feat.external')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'spec.md'),
      ['---', 'stage: plan', 'last_action: ext', 'updated_at: 2026-06-14', 'summary: ext', '---', '', '# Ext', ''].join('\n'),
      'utf8',
    )

    const evt = await readUntil(reader, decoder, (t) => t.includes('event: list-updated'), 4000)
    expect(evt).toContain('list-updated')
    await reader.cancel()
  })

  it('POST /api/specs/:id/inputs annotate writes ！！！ block and resets stage', async () => {
    const { cwd, url } = await startInTmp()
    const create = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A', type: 'feat', summary: 'a' }),
    })
    const { id } = (await create.json()) as { id: string }
    const res = await fetch(`${url}api/specs/${id}/inputs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'annotate',
        sectionPath: '1. 背景',
        quote: '现状不佳',
        note: '改为 X',
      }),
    })
    expect(res.status).toBe(200)
    const raw = await readFile(join(cwd, '.yorz', 'specs', id, 'spec.md'), 'utf8')
    expect(raw).toContain('> 1. 背景 中 "现状不佳"')
    expect(raw).toContain('> ！！！改为 X')
    expect(raw).toContain('stage: plan')
  })

  it('SSE pushes updated event when underlying file changes', async () => {
    const { cwd, url } = await startInTmp()
    const create = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Watch Me', type: 'fix', summary: 'watch summary' }),
    })
    const { id } = (await create.json()) as { id: string }

    const sseRes = await fetch(`${url}api/specs/${id}/events`, {
      headers: { accept: 'text/event-stream' },
    })
    expect(sseRes.body).not.toBeNull()
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()

    const ready = await readUntil(reader, decoder, (txt) => txt.includes('event: ready'))
    expect(ready).toContain('event: ready')

    await new Promise((r) => setTimeout(r, 200))
    const specPath = join(cwd, '.yorz', 'specs', id, 'spec.md')
    const original = await readFile(specPath, 'utf8')
    await writeFile(specPath, original + '\n\nedited externally\n', 'utf8')

    const updated = await readUntil(reader, decoder, (txt) => txt.includes('event: updated'), 3000)
    expect(updated).toContain('event: updated')

    await reader.cancel()
  })

  it('POST /api/specs/:id/run + SSE delivers agent-stdout and agent-exit', async () => {
    const { url } = await startInTmp({ fakeAgent: true })
    const create = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'R', type: 'feat', summary: 'r' }),
    })
    const { id } = (await create.json()) as { id: string }

    const sseRes = await fetch(`${url}api/specs/${id}/events`, {
      headers: { accept: 'text/event-stream' },
    })
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()
    await readUntil(reader, decoder, (t) => t.includes('event: ready'))

    const runRes = await fetch(`${url}api/specs/${id}/run`, { method: 'POST' })
    expect(runRes.status).toBe(200)
    const { runId } = (await runRes.json()) as { runId: string }
    expect(runId).toBeTruthy()

    const stdout = await readUntil(reader, decoder, (t) => t.includes('event: agent-stdout'), 4000)
    expect(stdout).toContain('received prompt')
    const exit = await readUntil(reader, decoder, (t) => t.includes('event: agent-exit'), 4000)
    expect(exit).toContain('agent-exit')

    await reader.cancel()
  })

  it('POST /api/specs/:id/explain returns runId and streams stdout', async () => {
    const { url } = await startInTmp({ fakeAgent: true })
    const create = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'E', type: 'feat', summary: 'e' }),
    })
    const { id } = (await create.json()) as { id: string }

    const sseRes = await fetch(`${url}api/specs/${id}/events`, {
      headers: { accept: 'text/event-stream' },
    })
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()
    await readUntil(reader, decoder, (t) => t.includes('event: ready'))

    const res = await fetch(`${url}api/specs/${id}/explain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '解释这一段' }),
    })
    expect(res.status).toBe(200)
    const evt = await readUntil(reader, decoder, (t) => t.includes('event: agent-stdout'), 4000)
    expect(evt).toContain('"mode":"explain"')
    await reader.cancel()
  })

  it('returns 404 for unknown spec', async () => {
    const { url } = await startInTmp()
    const res = await fetch(`${url}api/specs/does-not-exist`)
    expect(res.status).toBe(404)
  })

  it('400 on invalid type when creating spec', async () => {
    const { url } = await startInTmp()
    const res = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'bogus' }),
    })
    expect(res.status).toBe(400)
  })

  it('400 when annotate body is missing required fields', async () => {
    const { url } = await startInTmp()
    const create = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'X', type: 'feat', summary: 'x' }),
    })
    const { id } = (await create.json()) as { id: string }
    const res = await fetch(`${url}api/specs/${id}/inputs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'annotate', sectionPath: 's', quote: '', note: 'n' }),
    })
    expect(res.status).toBe(400)
  })
})

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  predicate: (text: string) => boolean,
  timeoutMs = 2000,
): Promise<string> {
  let accumulated = ''
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const next = (await Promise.race([
      reader.read(),
      new Promise<{ value?: Uint8Array; done: boolean }>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), remaining),
      ),
    ])) as { value?: Uint8Array; done: boolean }
    if (next.done) break
    if (next.value) accumulated += decoder.decode(next.value, { stream: true })
    if (predicate(accumulated)) return accumulated
  }
  throw new Error(`SSE predicate not satisfied; received: ${accumulated}`)
}
