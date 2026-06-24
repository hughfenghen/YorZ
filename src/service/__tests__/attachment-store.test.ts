import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AttachmentStore, AttachmentStoreError } from '../attachment-store.js'

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'yorz-att-'))
}

describe('AttachmentStore', () => {
  it('createDraft creates an attachments directory', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    const stats = await stat(store.draftAttachmentsDir(draftId))
    expect(stats.isDirectory()).toBe(true)
  })

  it('rejects unsupported MIME', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    await expect(
      store.addAttachment(draftId, {
        name: 'a.bin',
        mime: 'application/octet-stream',
        data: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toBeInstanceOf(AttachmentStoreError)
  })

  it('rejects oversized file', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd, maxFileSize: 8 })
    const draftId = await store.createDraft()
    await expect(
      store.addAttachment(draftId, {
        name: 'x.txt',
        mime: 'text/plain',
        data: new Uint8Array(16),
      }),
    ).rejects.toMatchObject({ code: 'file_too_large' })
  })

  it('rejects when count exceeds limit', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd, maxCount: 2 })
    const draftId = await store.createDraft()
    await store.addAttachment(draftId, {
      name: 'a.txt',
      mime: 'text/plain',
      data: new Uint8Array([0x41]),
    })
    await store.addAttachment(draftId, {
      name: 'b.txt',
      mime: 'text/plain',
      data: new Uint8Array([0x42]),
    })
    await expect(
      store.addAttachment(draftId, {
        name: 'c.txt',
        mime: 'text/plain',
        data: new Uint8Array([0x43]),
      }),
    ).rejects.toMatchObject({ code: 'too_many_attachments' })
  })

  it('rewrites placeholder image name to image-<uuid:4>.<ext>', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    const meta = await store.addAttachment(draftId, {
      name: 'image.png',
      mime: 'image/png',
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    })
    expect(meta.storedName).toMatch(/^image-[a-f0-9]{4}\.png$/)
    expect(meta.kind).toBe('image')
  })

  it('non-image attachments keep their name with suffix on collision', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    const first = await store.addAttachment(draftId, {
      name: 'design.pdf',
      mime: 'application/pdf',
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    })
    const second = await store.addAttachment(draftId, {
      name: 'design.pdf',
      mime: 'application/pdf',
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    })
    expect(first.storedName).toBe('design.pdf')
    expect(second.storedName).toBe('design-1.pdf')
  })

  it('sanitizes path-traversal characters in non-image names', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    const meta = await store.addAttachment(draftId, {
      name: '../../etc/passwd.txt',
      mime: 'text/plain',
      data: new Uint8Array([1]),
    })
    expect(meta.storedName).not.toContain('/')
    expect(meta.storedName).not.toContain('..')
    expect(meta.storedName.endsWith('.txt')).toBe(true)
  })

  it('rename preserves extension and errors on extension change', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    const meta = await store.addAttachment(draftId, {
      name: 'old.txt',
      mime: 'text/plain',
      data: new Uint8Array([1, 2]),
    })
    const renamed = await store.renameAttachment(draftId, meta.storedName, 'new')
    expect(renamed.storedName).toBe('new.txt')
    await expect(
      store.renameAttachment(draftId, renamed.storedName, 'new.md'),
    ).rejects.toMatchObject({ code: 'extension_changed' })
  })

  it('rename adds suffix on collision', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    const a = await store.addAttachment(draftId, {
      name: 'a.txt',
      mime: 'text/plain',
      data: new Uint8Array([1]),
    })
    await store.addAttachment(draftId, {
      name: 'b.txt',
      mime: 'text/plain',
      data: new Uint8Array([2]),
    })
    const renamed = await store.renameAttachment(draftId, a.storedName, 'b')
    expect(renamed.storedName).toBe('b-1.txt')
  })

  it('deleteAttachment removes the file and errors on missing', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    const meta = await store.addAttachment(draftId, {
      name: 'a.txt',
      mime: 'text/plain',
      data: new Uint8Array([1]),
    })
    await store.deleteAttachment(draftId, meta.storedName)
    await expect(store.deleteAttachment(draftId, meta.storedName)).rejects.toMatchObject({
      code: 'attachment_not_found',
    })
  })

  it('readAttachment returns bytes and inferred mime', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    const meta = await store.addAttachment(draftId, {
      name: 'a.md',
      mime: 'text/markdown',
      data: new Uint8Array([0x23, 0x20]),
    })
    const read = await store.readAttachment(draftId, meta.storedName)
    expect(read.mime).toBe('text/markdown')
    expect(read.kind).toBe('text')
    expect(Array.from(read.data)).toEqual([0x23, 0x20])
  })

  it('listAttachments lists current files only', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    await store.addAttachment(draftId, {
      name: 'a.txt',
      mime: 'text/plain',
      data: new Uint8Array([1]),
    })
    await store.addAttachment(draftId, {
      name: 'b.txt',
      mime: 'text/plain',
      data: new Uint8Array([2]),
    })
    const list = await store.listAttachments(draftId)
    expect(list.map((x) => x.storedName)).toEqual(['a.txt', 'b.txt'])
  })

  it('cleanupExpired removes dirs older than ttl and keeps fresh ones', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd, ttlMs: 60_000 })
    const fresh = await store.createDraft()
    const stale = await store.createDraft()
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await utimes(store.draftDir(stale), past, past)
    const { removed } = await store.cleanupExpired()
    expect(removed).toContain(stale)
    expect(removed).not.toContain(fresh)
  })

  it('cleanupExpired tolerates missing root', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const out = await store.cleanupExpired()
    expect(out.removed).toEqual([])
  })

  it('rejects unsafe stored names on read', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    await expect(store.readAttachment(draftId, '../escape.txt')).rejects.toBeInstanceOf(
      AttachmentStoreError,
    )
  })

  it('rejects add to non-existent draft', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    await expect(
      store.addAttachment('no-such-draft', {
        name: 'a.txt',
        mime: 'text/plain',
        data: new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({ code: 'draft_not_found' })
  })

  it('persists bytes on disk', async () => {
    const cwd = await tmp()
    const store = new AttachmentStore({ cwd })
    const draftId = await store.createDraft()
    const meta = await store.addAttachment(draftId, {
      name: 'a.txt',
      mime: 'text/plain',
      data: new Uint8Array([0x68, 0x69]),
    })
    const onDisk = await readFile(join(store.draftAttachmentsDir(draftId), meta.storedName))
    expect(onDisk.toString('utf8')).toBe('hi')
  })
})
