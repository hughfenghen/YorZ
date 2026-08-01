import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CommandRunStore } from '../command-store.js'
import type { CommandRun } from '../command-types.js'

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'yorz-cmd-store-'))
}

function run(runId: string, startedAt: number, patch: Partial<CommandRun> = {}): CommandRun {
  return {
    runId,
    commandId: `cmd-${runId}`,
    name: `name-${runId}`,
    cli: 'echo hi',
    pid: 1234,
    status: 'running',
    startedAt,
    logFile: `.yorz/tmp/commands/${runId}.log`,
    ...patch,
  }
}

describe('CommandRunStore', () => {
  it('returns an empty list when the index file does not exist', async () => {
    const store = new CommandRunStore(await tmp())
    expect(await store.list()).toEqual([])
    expect(await store.get('nope')).toBeUndefined()
  })

  it('persists upserts and reloads them from disk', async () => {
    const cwd = await tmp()
    const store = new CommandRunStore(cwd)
    await store.upsert(run('a', 1000))
    await store.upsert(run('b', 2000))

    const reloaded = new CommandRunStore(cwd)
    const items = await reloaded.list()
    expect(items.map((r) => r.runId)).toEqual(['b', 'a']) // newest first
  })

  it('merges fields on upsert of an existing runId', async () => {
    const store = new CommandRunStore(await tmp())
    await store.upsert(run('a', 1000))
    await store.upsert(run('a', 1000, { status: 'exited', exitCode: 0, endedAt: 5000 }))
    const items = await store.list()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ runId: 'a', status: 'exited', exitCode: 0 })
  })

  it('does not lose data when upserts are issued concurrently', async () => {
    const cwd = await tmp()
    const store = new CommandRunStore(cwd)
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.upsert(run(`r${i}`, 1000 + i))),
    )
    const raw = JSON.parse(await readFile(join(cwd, '.yorz/tmp/commands/index.json'), 'utf8'))
    expect(raw).toHaveLength(20)
  })

  it('remove drops the record and reports whether it existed', async () => {
    const store = new CommandRunStore(await tmp())
    await store.upsert(run('a', 1000))
    expect(await store.remove('a')).toBe(true)
    expect(await store.remove('a')).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it('replaceAll overwrites the whole index', async () => {
    const store = new CommandRunStore(await tmp())
    await store.upsert(run('a', 1000))
    await store.upsert(run('b', 2000))
    await store.replaceAll([run('c', 3000)])
    expect((await store.list()).map((r) => r.runId)).toEqual(['c'])
  })

  it('falls back to an empty list when the index file is corrupt', async () => {
    const cwd = await tmp()
    await mkdir(join(cwd, '.yorz/tmp/commands'), { recursive: true })
    await writeFile(join(cwd, '.yorz/tmp/commands/index.json'), '{not json', 'utf8')
    expect(await new CommandRunStore(cwd).list()).toEqual([])
  })
})
