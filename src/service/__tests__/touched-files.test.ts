import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TouchedFilesStore } from '../touched-files.js'

const dirs: string[] = []

afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop()!
    await rm(d, { recursive: true, force: true })
  }
})

async function mkCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'yorz-touched-'))
  dirs.push(cwd)
  return cwd
}

describe('TouchedFilesStore', () => {
  it('read returns [] when no file exists yet', async () => {
    const cwd = await mkCwd()
    const store = new TouchedFilesStore({ cwd })
    expect(await store.read('spec-1')).toEqual([])
  })

  it('add deduplicates and persists relative POSIX paths', async () => {
    const cwd = await mkCwd()
    const store = new TouchedFilesStore({ cwd })
    await store.add('spec-1', ['src/a.ts', 'src/b.ts', 'src/a.ts'])
    await store.add('spec-1', ['src/b.ts'])
    expect(await store.read('spec-1')).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('add normalizes absolute paths inside cwd to relative', async () => {
    const cwd = await mkCwd()
    const store = new TouchedFilesStore({ cwd })
    await store.add('spec-1', [join(cwd, 'pkg/x.ts')])
    expect(await store.read('spec-1')).toEqual(['pkg/x.ts'])
  })

  it('add ignores empty / outside-of-cwd inputs', async () => {
    const cwd = await mkCwd()
    const store = new TouchedFilesStore({ cwd })
    await store.add('spec-1', ['', '  ', '../escape.ts'])
    expect(await store.read('spec-1')).toEqual([])
  })

  it('remove deletes the file when the set becomes empty', async () => {
    const cwd = await mkCwd()
    const store = new TouchedFilesStore({ cwd })
    await store.add('spec-1', ['a.ts'])
    expect(existsSync(store.filePath('spec-1'))).toBe(true)
    await store.remove('spec-1', ['a.ts'])
    expect(await store.read('spec-1')).toEqual([])
    expect(existsSync(store.filePath('spec-1'))).toBe(false)
  })

  it('remove drops only the matching subset', async () => {
    const cwd = await mkCwd()
    const store = new TouchedFilesStore({ cwd })
    await store.add('spec-1', ['a.ts', 'b.ts', 'c.ts'])
    await store.remove('spec-1', ['b.ts'])
    expect(await store.read('spec-1')).toEqual(['a.ts', 'c.ts'])
  })
})
