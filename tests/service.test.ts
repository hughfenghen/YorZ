import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TextDecoder } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../src/service/index.js'

let handle: ServeHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
})

async function startInTmp() {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-service-'))
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
    expect(created.id).toMatch(/^\d{6}\.feat\.a-test-spec/)

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
    let buffer = ''

    const ready = await readUntil(reader, decoder, (txt) => txt.includes('event: ready'))
    expect(ready).toContain('event: ready')
    buffer = ''

    // wait briefly to ensure chokidar is fully ready before mutating the file
    await new Promise((r) => setTimeout(r, 200))
    const specPath = join(cwd, '.yorz', 'specs', id, 'spec.md')
    const original = await readFile(specPath, 'utf8')
    await writeFile(specPath, original + '\n\nedited externally\n', 'utf8')

    const updated = await readUntil(reader, decoder, (txt) => txt.includes('event: updated'), 3000)
    expect(updated).toContain('event: updated')

    await reader.cancel()
  })

  it('returns 404 for unknown spec', async () => {
    const { url } = await startInTmp()
    const res = await fetch(`${url}api/specs/does-not-exist`)
    expect(res.status).toBe(404)
  })

  it('400 on missing fields when creating spec', async () => {
    const { url } = await startInTmp()
    const res = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '', type: 'feat', summary: 'x' }),
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
