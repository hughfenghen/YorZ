import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentLogStore } from '../agent-log-store.js'

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'yorz-log-'))
}

describe('AgentLogStore', () => {
  it('ensureRoot creates .yorz/tmp/agent-logs directory', async () => {
    const cwd = await tmp()
    const store = new AgentLogStore({ cwd })
    await store.ensureRoot()
    const s = await stat(join(cwd, '.yorz', 'tmp', 'agent-logs'))
    expect(s.isDirectory()).toBe(true)
  })

  it('openWriter writes initial meta, appends chunks, finalize updates meta', async () => {
    const cwd = await tmp()
    let nowVal = 1_000
    const store = new AgentLogStore({ cwd, now: () => nowVal })
    await store.ensureRoot()
    const writer = await store.openWriter({
      runId: 'r1',
      specId: 's1',
      mode: 'skill-run',
      startedAt: 100,
    })
    const metaPath = join(cwd, '.yorz', 'tmp', 'agent-logs', 's1', 'r1.json')
    const logPath = join(cwd, '.yorz', 'tmp', 'agent-logs', 's1', 'r1.log')

    const initialRaw = await readFile(metaPath, 'utf8')
    const initial = JSON.parse(initialRaw)
    expect(initial.endedAt).toBeNull()
    expect(initial.exitCode).toBeNull()

    writer.append('hello ')
    writer.append('world\n')
    nowVal = 2_000
    await writer.finalize({ exitCode: 0 })

    const log = await readFile(logPath, 'utf8')
    expect(log).toBe('hello world\n')

    const finalRaw = await readFile(metaPath, 'utf8')
    const final = JSON.parse(finalRaw)
    expect(final.endedAt).toBe(2_000)
    expect(final.exitCode).toBe(0)
    expect(final.sizeBytes).toBe(Buffer.byteLength('hello world\n', 'utf8'))
  })

  it('listBySpec returns metas sorted by startedAt descending', async () => {
    const cwd = await tmp()
    const store = new AgentLogStore({ cwd })
    await store.ensureRoot()
    for (const [runId, startedAt] of [
      ['r-old', 100],
      ['r-new', 300],
      ['r-mid', 200],
    ] as const) {
      const w = await store.openWriter({ runId, specId: 's1', mode: 'skill-run', startedAt })
      w.append('x')
      await w.finalize({ exitCode: 0 })
    }
    const list = await store.listBySpec('s1')
    expect(list.map((m) => m.runId)).toEqual(['r-new', 'r-mid', 'r-old'])
  })

  it('readLog truncates large files to the trailing maxBytes', async () => {
    const cwd = await tmp()
    const store = new AgentLogStore({ cwd })
    await store.ensureRoot()
    const w = await store.openWriter({
      runId: 'big',
      specId: 's1',
      mode: 'skill-run',
      startedAt: 1,
    })
    // 300KB of "A"
    w.append('A'.repeat(300 * 1024))
    await w.finalize({ exitCode: 0 })

    const max = 256 * 1024
    const res = await store.readLog('s1', 'big', { maxBytes: max })
    expect(res.truncated).toBe(true)
    expect(res.content.length).toBe(max)
    expect(res.content[res.content.length - 1]).toBe('A')

    const full = await store.readLog('s1', 'big')
    expect(full.truncated).toBe(false)
    expect(full.content.length).toBe(300 * 1024)
  })

  it('cleanupExpired removes runs older than ttlMs based on endedAt', async () => {
    const cwd = await tmp()
    let nowVal = 1_000_000
    const ttlMs = 1_000
    const store = new AgentLogStore({ cwd, now: () => nowVal, ttlMs })
    await store.ensureRoot()

    const oldW = await store.openWriter({
      runId: 'old',
      specId: 's1',
      mode: 'skill-run',
      startedAt: 0,
    })
    oldW.append('o')
    await oldW.finalize({ exitCode: 0 }) // endedAt = 1_000_000
    nowVal = 1_000_000 + ttlMs + 500 // advance now well past cutoff
    const freshW = await store.openWriter({
      runId: 'fresh',
      specId: 's1',
      mode: 'skill-run',
      startedAt: nowVal,
    })
    freshW.append('f')
    await freshW.finalize({ exitCode: 0 }) // endedAt = nowVal (== current now)

    const result = await store.cleanupExpired()
    expect(result.removed).toContain('old')
    expect(result.removed).not.toContain('fresh')

    const list = await store.listBySpec('s1')
    expect(list.map((m) => m.runId)).toEqual(['fresh'])
  })

  it('cleanupExpired falls back to mtimeMs when meta lacks endedAt', async () => {
    const cwd = await tmp()
    const now = 1_000_000
    const ttlMs = 1_000
    const store = new AgentLogStore({ cwd, now: () => now, ttlMs })
    await store.ensureRoot()
    const dir = join(cwd, '.yorz', 'tmp', 'agent-logs', 's1')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    // Hand-craft a meta without endedAt
    await writeFile(
      join(dir, 'orphan.json'),
      JSON.stringify({
        runId: 'orphan',
        specId: 's1',
        mode: 'skill-run',
        startedAt: 0,
        endedAt: null,
        exitCode: null,
        sizeBytes: 0,
      }),
      'utf8',
    )
    await writeFile(join(dir, 'orphan.log'), 'x', 'utf8')
    // Force mtime well in the past
    const { utimes } = await import('node:fs/promises')
    const past = new Date(now - ttlMs - 5_000)
    await utimes(join(dir, 'orphan.json'), past, past)

    const result = await store.cleanupExpired()
    expect(result.removed).toContain('orphan')
  })
})
