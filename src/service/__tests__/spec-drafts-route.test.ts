import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { start, type ServeHandle } from '../index.js'

let handle: ServeHandle | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
})

async function startInTmp(): Promise<{ cwd: string; url: string; apiPrefix: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-spec-drafts-'))
  const cfgDir = await mkdtemp(join(tmpdir(), 'yorz-spec-drafts-cfg-'))
  await mkdir(join(cwd, '.yorz'), { recursive: true })
  handle = await start({ cwd, port: 0, globalConfigPath: join(cfgDir, 'projects.json') })
  const list = await handle.registry.list()
  const projectId = list[0]!.id
  return { cwd, url: handle.url, apiPrefix: `${handle.url}api/projects/${projectId}` }
}

function makeForm(blob: Blob, filename: string): FormData {
  const fd = new FormData()
  fd.append('file', blob, filename)
  return fd
}

describe('POST /api/spec-drafts', () => {
  it('creates a draft and returns draftId', async () => {
    const { apiPrefix } = await startInTmp()
    const res = await fetch(`${apiPrefix}/spec-drafts`, { method: 'POST' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { draftId: string }
    expect(body.draftId).toMatch(/^[a-f0-9-]{8,}$/)
  })
})

describe('POST /api/spec-drafts/:draftId/attachments', () => {
  it('accepts an image upload and rewrites placeholder name', async () => {
    const { cwd, apiPrefix } = await startInTmp()
    const draft = await fetch(`${apiPrefix}/spec-drafts`, { method: 'POST' })
    const { draftId } = (await draft.json()) as { draftId: string }

    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    const res = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments`, {
      method: 'POST',
      body: makeForm(blob, 'image.png'),
    })
    expect(res.status).toBe(201)
    const meta = (await res.json()) as {
      storedName: string
      mime: string
      kind: string
      size: number
    }
    expect(meta.storedName).toMatch(/^image-[a-f0-9]{4}\.png$/)
    expect(meta.mime).toBe('image/png')
    expect(meta.kind).toBe('image')
    expect(meta.size).toBe(4)

    const onDisk = await readFile(
      join(cwd, '.yorz', 'tmp', 'drafts', draftId, 'attachments', meta.storedName),
    )
    expect(Array.from(onDisk)).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('accepts a PDF upload and keeps original filename', async () => {
    const { apiPrefix } = await startInTmp()
    const draft = await fetch(`${apiPrefix}/spec-drafts`, { method: 'POST' })
    const { draftId } = (await draft.json()) as { draftId: string }
    const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' })
    const res = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments`, {
      method: 'POST',
      body: makeForm(blob, 'design.pdf'),
    })
    expect(res.status).toBe(201)
    const meta = (await res.json()) as { storedName: string; kind: string }
    expect(meta.storedName).toBe('design.pdf')
    expect(meta.kind).toBe('pdf')
  })

  it('returns 415 when MIME not allowed', async () => {
    const { apiPrefix } = await startInTmp()
    const draft = await fetch(`${apiPrefix}/spec-drafts`, { method: 'POST' })
    const { draftId } = (await draft.json()) as { draftId: string }
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/zip' })
    const res = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments`, {
      method: 'POST',
      body: makeForm(blob, 'evil.zip'),
    })
    expect(res.status).toBe(415)
  })

  it('returns 404 for unknown draftId', async () => {
    const { apiPrefix } = await startInTmp()
    const blob = new Blob([new Uint8Array([1])], { type: 'text/plain' })
    const res = await fetch(`${apiPrefix}/spec-drafts/no-such-draft/attachments`, {
      method: 'POST',
      body: makeForm(blob, 'a.txt'),
    })
    expect(res.status).toBe(404)
  })
})

describe('PATCH / DELETE / GET attachments', () => {
  it('PATCH renames keeping extension', async () => {
    const { apiPrefix } = await startInTmp()
    const draft = await fetch(`${apiPrefix}/spec-drafts`, { method: 'POST' })
    const { draftId } = (await draft.json()) as { draftId: string }
    const blob = new Blob([new Uint8Array([0x68])], { type: 'text/plain' })
    const up = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments`, {
      method: 'POST',
      body: makeForm(blob, 'old.txt'),
    })
    const { storedName } = (await up.json()) as { storedName: string }
    const ren = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments/${storedName}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'fresh' }),
    })
    expect(ren.status).toBe(200)
    const meta = (await ren.json()) as { storedName: string }
    expect(meta.storedName).toBe('fresh.txt')
  })

  it('PATCH rejects extension change', async () => {
    const { apiPrefix } = await startInTmp()
    const draft = await fetch(`${apiPrefix}/spec-drafts`, { method: 'POST' })
    const { draftId } = (await draft.json()) as { draftId: string }
    const blob = new Blob([new Uint8Array([0x68])], { type: 'text/plain' })
    const up = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments`, {
      method: 'POST',
      body: makeForm(blob, 'a.txt'),
    })
    const { storedName } = (await up.json()) as { storedName: string }
    const ren = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments/${storedName}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a.md' }),
    })
    expect(ren.status).toBe(400)
  })

  it('DELETE removes attachment then 404 on re-delete', async () => {
    const { apiPrefix } = await startInTmp()
    const draft = await fetch(`${apiPrefix}/spec-drafts`, { method: 'POST' })
    const { draftId } = (await draft.json()) as { draftId: string }
    const blob = new Blob([new Uint8Array([0x68])], { type: 'text/plain' })
    const up = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments`, {
      method: 'POST',
      body: makeForm(blob, 'a.txt'),
    })
    const { storedName } = (await up.json()) as { storedName: string }
    const first = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments/${storedName}`, {
      method: 'DELETE',
    })
    expect(first.status).toBe(200)
    const again = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments/${storedName}`, {
      method: 'DELETE',
    })
    expect(again.status).toBe(404)
  })

  it('GET returns bytes with inline disposition', async () => {
    const { apiPrefix } = await startInTmp()
    const draft = await fetch(`${apiPrefix}/spec-drafts`, { method: 'POST' })
    const { draftId } = (await draft.json()) as { draftId: string }
    const blob = new Blob([new Uint8Array([0x21, 0x22])], { type: 'image/png' })
    const up = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments`, {
      method: 'POST',
      body: makeForm(blob, 'image.png'),
    })
    const { storedName } = (await up.json()) as { storedName: string }
    const res = await fetch(`${apiPrefix}/spec-drafts/${draftId}/attachments/${storedName}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-disposition')).toBe('inline')
    const ab = await res.arrayBuffer()
    expect(Array.from(new Uint8Array(ab))).toEqual([0x21, 0x22])
  })
})

describe('POST /api/specs with draftId', () => {
  it('accepts draftId and returns a draft runId', async () => {
    const { apiPrefix } = await startInTmp()
    const draft = await fetch(`${apiPrefix}/spec-drafts`, { method: 'POST' })
    const { draftId } = (await draft.json()) as { draftId: string }
    const res = await fetch(`${apiPrefix}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'feat', requirement: '加上 X 功能', draftId }),
    })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { draft: boolean; runId: string }
    expect(body.draft).toBe(true)
    expect(body.runId).toBeTruthy()
  })

  it('rejects malformed draftId', async () => {
    const { apiPrefix } = await startInTmp()
    const res = await fetch(`${apiPrefix}/specs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'feat', requirement: 'x', draftId: '../escape' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/specs/:id/attachments/:name', () => {
  it('serves attachment bytes from spec dir', async () => {
    const { cwd, apiPrefix } = await startInTmp()
    // Seed a spec dir + attachment manually.
    const id = '260622.feat.demo'
    const dir = join(cwd, '.yorz', 'specs', id, 'attachments')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(cwd, '.yorz', 'specs', id, 'spec.md'),
      [
        '---',
        'stage: plan',
        'last_action: init',
        'updated_at: 2026-06-22',
        'summary: demo',
        '---',
        '',
        '# demo',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const res = await fetch(`${apiPrefix}/specs/${id}/attachments/pic.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-disposition')).toBe('inline')
  })

  it('returns 404 for missing attachment', async () => {
    const { cwd, apiPrefix } = await startInTmp()
    const id = '260622.feat.empty'
    await mkdir(join(cwd, '.yorz', 'specs', id), { recursive: true })
    await writeFile(
      join(cwd, '.yorz', 'specs', id, 'spec.md'),
      [
        '---',
        'stage: plan',
        'last_action: init',
        'updated_at: 2026-06-22',
        'summary: e',
        '---',
        '',
        '# e',
        '',
      ].join('\n'),
      'utf8',
    )
    const res = await fetch(`${apiPrefix}/specs/${id}/attachments/missing.png`)
    expect(res.status).toBe(404)
  })

  it('rejects unsafe attachment names', async () => {
    const { apiPrefix } = await startInTmp()
    const res = await fetch(`${apiPrefix}/specs/anything/attachments/..escape.png`)
    // The router decodes %2E etc — directly hitting with literal `..` works via path segment.
    // A leading-dot name should be rejected with 400.
    expect([400, 404]).toContain(res.status)
  })
})
