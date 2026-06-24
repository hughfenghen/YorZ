import { Hono } from 'hono'
import { AttachmentStore, AttachmentStoreError, classifyMime } from '../attachment-store.js'

export interface SpecDraftsDeps {
  store: AttachmentStore
}

export function createSpecDraftsRoutes(deps: SpecDraftsDeps): Hono {
  const app = new Hono()
  const { store } = deps

  app.post('/spec-drafts', async (c) => {
    // Fire-and-forget TTL sweep on every create.
    void store.cleanupExpired().catch(() => {})
    const draftId = await store.createDraft()
    return c.json({ draftId }, 201)
  })

  app.post('/spec-drafts/:draftId/attachments', async (c) => {
    const draftId = c.req.param('draftId')
    if (!(await store.draftExists(draftId))) {
      return c.json({ error: 'draft not found' }, 404)
    }
    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      return c.json({ error: 'invalid multipart body' }, 400)
    }
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      return c.json({ error: 'field "file" required' }, 400)
    }
    const blob = file as File
    const buf = new Uint8Array(await blob.arrayBuffer())
    const mime = blob.type || ''
    const name = blob.name || 'attachment'
    if (!classifyMime(mime)) {
      return c.json({ error: `unsupported MIME: ${mime || '(empty)'}` }, 415)
    }
    try {
      const meta = await store.addAttachment(draftId, { name, mime, data: buf })
      return c.json(meta, 201)
    } catch (err) {
      return errorResponse(c, err)
    }
  })

  app.delete('/spec-drafts/:draftId/attachments/:storedName', async (c) => {
    const draftId = c.req.param('draftId')
    const storedName = c.req.param('storedName')
    if (!(await store.draftExists(draftId))) {
      return c.json({ error: 'draft not found' }, 404)
    }
    try {
      await store.deleteAttachment(draftId, storedName)
      return c.json({ ok: true })
    } catch (err) {
      return errorResponse(c, err)
    }
  })

  app.patch('/spec-drafts/:draftId/attachments/:storedName', async (c) => {
    const draftId = c.req.param('draftId')
    const storedName = c.req.param('storedName')
    if (!(await store.draftExists(draftId))) {
      return c.json({ error: 'draft not found' }, 404)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const name = (body as { name?: unknown } | null)?.name
    if (typeof name !== 'string' || !name.trim()) {
      return c.json({ error: 'name required' }, 400)
    }
    try {
      const meta = await store.renameAttachment(draftId, storedName, name)
      return c.json(meta)
    } catch (err) {
      return errorResponse(c, err)
    }
  })

  app.get('/spec-drafts/:draftId/attachments/:storedName', async (c) => {
    const draftId = c.req.param('draftId')
    const storedName = c.req.param('storedName')
    if (!(await store.draftExists(draftId))) {
      return c.json({ error: 'draft not found' }, 404)
    }
    try {
      const { data, mime } = await store.readAttachment(draftId, storedName)
      c.header('Content-Type', mime)
      c.header('Content-Disposition', 'inline')
      c.header('Cache-Control', 'no-store')
      return c.body(new Uint8Array(data))
    } catch (err) {
      return errorResponse(c, err)
    }
  })

  return app
}

function errorResponse(c: import('hono').Context, err: unknown): Response {
  if (err instanceof AttachmentStoreError) {
    const status =
      err.code === 'draft_not_found' || err.code === 'attachment_not_found'
        ? 404
        : err.code === 'file_too_large'
          ? 413
          : err.code === 'invalid_mime'
            ? 415
            : err.code === 'too_many_attachments'
              ? 409
              : 400
    return c.json({ error: err.message, code: err.code }, status)
  }
  return c.json({ error: (err as Error).message }, 500)
}
