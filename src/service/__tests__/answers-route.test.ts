import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'

let handle: ServeHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
})

async function startInTmp() {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-answers-'))
  handle = await start({ cwd, port: 0 })
  return { cwd, url: handle.url }
}

describe('POST /api/specs/:id/questions/answers', () => {
  it('200 writes ## 用户批注 section with answers and freeform annotations', async () => {
    const { cwd, url } = await startInTmp()
    const create = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A', type: 'feat', summary: 'a' }),
    })
    const { id } = (await create.json()) as { id: string }
    const res = await fetch(`${url}api/specs/${id}/questions/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: [
          {
            questionId: 'q-0',
            questionText: 'Q1',
            selectedOptionLabel: 'A',
            note: 'nice',
          },
        ],
        freeformAnnotations: [{ sectionPath: '3 现状', quote: 'foo', note: 'bar' }],
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const raw = await readFile(join(cwd, '.yorz', 'specs', id, 'spec.md'), 'utf8')
    expect(raw).toContain('## 用户批注')
    expect(raw).toContain('> 待确认问题："Q1"')
    expect(raw).toContain('> ！！！选择：A；备注：nice')
    expect(raw).toContain('> 3 现状 中 "foo"')
    expect(raw).toContain('> ！！！bar')
    expect(raw).toContain('stage: plan')
  })

  it('400 when body has no answers and no freeforms', async () => {
    const { url } = await startInTmp()
    const create = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A', type: 'feat', summary: 'a' }),
    })
    const { id } = (await create.json()) as { id: string }
    const res = await fetch(`${url}api/specs/${id}/questions/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [], freeformAnnotations: [] }),
    })
    expect(res.status).toBe(400)
  })

  it('400 when answer is missing both selectedOptionLabel and note', async () => {
    const { url } = await startInTmp()
    const create = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A', type: 'feat', summary: 'a' }),
    })
    const { id } = (await create.json()) as { id: string }
    const res = await fetch(`${url}api/specs/${id}/questions/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: [{ questionText: 'Q' }],
        freeformAnnotations: [],
      }),
    })
    expect(res.status).toBe(400)
  })

  it('404 when spec does not exist', async () => {
    const { url } = await startInTmp()
    const res = await fetch(`${url}api/specs/no-such-spec/questions/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: [{ questionText: 'Q', selectedOptionLabel: 'A' }],
        freeformAnnotations: [],
      }),
    })
    expect(res.status).toBe(404)
  })

  it('400 on invalid JSON', async () => {
    const { url } = await startInTmp()
    const create = await fetch(`${url}api/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'A', type: 'feat', summary: 'a' }),
    })
    const { id } = (await create.json()) as { id: string }
    const res = await fetch(`${url}api/specs/${id}/questions/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})
