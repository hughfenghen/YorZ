import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentModelCatalogCache, MODEL_CATALOG_TTL_MS } from '../model-catalog-cache.js'
import type { AgentModelCatalog } from '../types.js'

function catalog(...ids: string[]): AgentModelCatalog {
  return {
    models: ids.map((id) => ({ id, displayName: id, reasoningEfforts: [] })),
    defaultReasoningEfforts: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AgentModelCatalogCache', () => {
  it('冷路径等待 loader 并写入内存', async () => {
    const cache = new AgentModelCatalogCache({ ttlMs: 1000, now: () => 0 })
    const load = vi.fn(async () => catalog('a'))
    expect(await cache.get('opencode-v2', load)).toEqual(catalog('a'))
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.peek('opencode-v2')).toEqual(catalog('a'))
  })

  it('TTL 内直接命中，不再调用 loader', async () => {
    let now = 0
    const cache = new AgentModelCatalogCache({ ttlMs: 1000, now: () => now })
    const load = vi.fn(async () => catalog('a'))
    await cache.get('x', load)
    now = 999
    expect(await cache.get('x', load)).toEqual(catalog('a'))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('过期时先返回旧值，随后后台刷新', async () => {
    let now = 0
    const cache = new AgentModelCatalogCache({ ttlMs: 1000, now: () => now })
    const first = vi.fn(async () => catalog('old'))
    await cache.get('x', first)

    now = MODEL_CATALOG_TTL_MS + 1
    const refresh = deferred<AgentModelCatalog>()
    const load = vi.fn(() => refresh.promise)
    // 过期读取不得等待刷新：loader 尚未 resolve，get 已经返回旧值。
    expect(await cache.get('x', load)).toEqual(catalog('old'))
    expect(load).toHaveBeenCalledTimes(1)

    refresh.resolve(catalog('new'))
    await settle()
    expect(cache.peek('x')).toEqual(catalog('new'))
  })

  it('后台刷新失败保留旧值且不抛出', async () => {
    let now = 0
    const cache = new AgentModelCatalogCache({ ttlMs: 1000, now: () => now })
    await cache.get('x', async () => catalog('old'))
    now = 2000
    const load = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(await cache.get('x', load)).toEqual(catalog('old'))
    await settle()
    expect(cache.peek('x')).toEqual(catalog('old'))
  })

  it('同一 kind 的并发请求只调用一次 loader', async () => {
    const cache = new AgentModelCatalogCache()
    const pending = deferred<AgentModelCatalog>()
    const load = vi.fn(() => pending.promise)
    const a = cache.get('x', load)
    const b = cache.get('x', load)
    pending.resolve(catalog('a'))
    expect(await Promise.all([a, b])).toEqual([catalog('a'), catalog('a')])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('空目录不入缓存，下次请求重试', async () => {
    const cache = new AgentModelCatalogCache({ ttlMs: 60_000 })
    const empty = vi.fn(async () => catalog())
    expect(await cache.get('x', empty)).toEqual(catalog())
    expect(cache.peek('x')).toBeUndefined()
    await cache.get('x', empty)
    expect(empty).toHaveBeenCalledTimes(2)
  })

  it('落盘后新实例无需 loader 即可命中', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yorz-model-cache-'))
    const filePath = join(dir, 'cache', 'agent-models.json')

    const first = new AgentModelCatalogCache({ filePath })
    await first.get('opencode', async () => catalog('a', 'b'))
    await first.flush()

    const saved = JSON.parse(await readFile(filePath, 'utf8')) as {
      catalogs: Record<string, { catalog: AgentModelCatalog }>
    }
    expect(Object.keys(saved.catalogs)).toEqual(['opencode'])

    const second = new AgentModelCatalogCache({ filePath })
    const load = vi.fn(async () => catalog('c'))
    expect(await second.get('opencode', load)).toEqual(catalog('a', 'b'))
    expect(load).not.toHaveBeenCalled()
  })

  it('损坏的磁盘缓存被忽略并回落到 loader', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yorz-model-cache-'))
    const filePath = join(dir, 'agent-models.json')
    await writeFile(filePath, '{not json', 'utf8')

    const cache = new AgentModelCatalogCache({ filePath })
    const load = vi.fn(async () => catalog('a'))
    expect(await cache.get('opencode', load)).toEqual(catalog('a'))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('invalidate 后重新走 loader', async () => {
    const cache = new AgentModelCatalogCache({ ttlMs: 60_000 })
    const load = vi.fn(async () => catalog('a'))
    await cache.get('x', load)
    cache.invalidate('x')
    await cache.get('x', load)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
