import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_ASSET_TTL_MS,
  EMPTY_AGENT_MODEL_CATALOG,
  isAgentCatalogLoading,
  isAgentRosterLoading,
  loadAgentCatalog,
  loadAgentRoster,
  peekAgentCatalog,
  peekAgentCatalogOrEmpty,
  peekAgentRoster,
  resetAgentAssetCache,
} from '../agent-catalog-cache.js'
import type { AgentDescriptor, AgentModelCatalog } from '../../api/index.js'

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

const ROSTER: AgentDescriptor[] = [
  {
    id: 'claude',
    displayName: 'ClaudeCode',
    source: 'builtin',
    capabilities: { listSessions: true, getMessages: true, usageStatus: true },
  },
]

afterEach(() => {
  resetAgentAssetCache()
  vi.useRealTimers()
})

describe('agent-catalog-cache', () => {
  it('冷加载置 loading，完成后写入缓存并清除 loading', async () => {
    const pending = deferred<AgentModelCatalog>()
    const load = vi.fn(() => pending.promise)
    const task = loadAgentCatalog('opencode-v2', load)
    expect(isAgentCatalogLoading('opencode-v2')).toBe(true)
    expect(peekAgentCatalog('opencode-v2')).toBeUndefined()

    pending.resolve(catalog('a'))
    expect(await task).toEqual(catalog('a'))
    expect(isAgentCatalogLoading('opencode-v2')).toBe(false)
    expect(peekAgentCatalog('opencode-v2')).toEqual(catalog('a'))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('TTL 内重复调用只请求一次（跨项目复用同一份目录）', async () => {
    const load = vi.fn(async () => catalog('a'))
    await loadAgentCatalog('opencode', load)
    await loadAgentCatalog('opencode', load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('过期后先返回旧值，后台刷新不置 loading', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    await loadAgentCatalog('opencode', async () => catalog('old'))

    vi.setSystemTime(AGENT_ASSET_TTL_MS + 1)
    const pending = deferred<AgentModelCatalog>()
    const load = vi.fn(() => pending.promise)
    expect(await loadAgentCatalog('opencode', load)).toEqual(catalog('old'))
    expect(load).toHaveBeenCalledTimes(1)
    // 后台刷新期间不得让设置页回到 loading 态。
    expect(isAgentCatalogLoading('opencode')).toBe(false)

    pending.resolve(catalog('new'))
    await settle()
    expect(peekAgentCatalog('opencode')).toEqual(catalog('new'))
  })

  it('并发调用合并为一个请求', async () => {
    const pending = deferred<AgentModelCatalog>()
    const load = vi.fn(() => pending.promise)
    const a = loadAgentCatalog('x', load)
    const b = loadAgentCatalog('x', load)
    pending.resolve(catalog('a'))
    expect(await Promise.all([a, b])).toEqual([catalog('a'), catalog('a')])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('空目录不入缓存，下次仍会重试', async () => {
    const load = vi.fn(async () => catalog())
    expect(await loadAgentCatalog('x', load)).toEqual(catalog())
    expect(peekAgentCatalog('x')).toBeUndefined()
    expect(peekAgentCatalogOrEmpty('x')).toEqual(EMPTY_AGENT_MODEL_CATALOG)
    await loadAgentCatalog('x', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('冷加载失败会抛出并清除 loading', async () => {
    const load = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(loadAgentCatalog('x', load)).rejects.toThrow('boom')
    expect(isAgentCatalogLoading('x')).toBe(false)
    expect(peekAgentCatalog('x')).toBeUndefined()
  })

  it('Agent 名单共享缓存：第二次不再请求', async () => {
    const first = vi.fn(async () => ROSTER)
    expect(await loadAgentRoster(first)).toEqual(ROSTER)
    expect(isAgentRosterLoading()).toBe(false)
    expect(peekAgentRoster()).toEqual(ROSTER)

    const second = vi.fn(async () => [])
    expect(await loadAgentRoster(second)).toEqual(ROSTER)
    expect(second).not.toHaveBeenCalled()
  })

  it('名单过期时先返回旧值，后台刷新不置 loading', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    await loadAgentRoster(async () => ROSTER)

    vi.setSystemTime(AGENT_ASSET_TTL_MS + 1)
    const pending = deferred<AgentDescriptor[]>()
    const load = vi.fn(() => pending.promise)
    expect(await loadAgentRoster(load)).toEqual(ROSTER)
    expect(load).toHaveBeenCalledTimes(1)
    expect(isAgentRosterLoading()).toBe(false)

    const next: AgentDescriptor[] = [{ ...ROSTER[0]!, displayName: 'ClaudeCode next' }]
    pending.resolve(next)
    await settle()
    expect(peekAgentRoster()).toEqual(next)
  })

  it('resetAgentAssetCache 清空全部缓存', async () => {
    await loadAgentCatalog('x', async () => catalog('a'))
    await loadAgentRoster(async () => ROSTER)
    resetAgentAssetCache()
    expect(peekAgentCatalog('x')).toBeUndefined()
    expect(peekAgentRoster()).toBeNull()
  })
})
