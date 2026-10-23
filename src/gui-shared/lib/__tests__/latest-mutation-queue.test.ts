import { describe, expect, it, vi } from 'vitest'
import { createLatestMutationQueue } from '../latest-mutation-queue.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createLatestMutationQueue', () => {
  it('按操作顺序执行写入，且旧响应不覆盖最新乐观状态', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const order: string[] = []
    const apply = vi.fn()
    const queue = createLatestMutationQueue()

    const firstRun = queue.enqueue({
      task: () => {
        order.push('first')
        return first.promise
      },
      onLatestSuccess: apply,
    })
    const secondRun = queue.enqueue({
      task: () => {
        order.push('second')
        return second.promise
      },
      onLatestSuccess: apply,
    })

    await Promise.resolve()
    expect(order).toEqual(['first'])
    first.resolve('old-config')
    await firstRun
    expect(apply).not.toHaveBeenCalled()
    expect(order).toEqual(['first', 'second'])

    second.resolve('new-config')
    await secondRun
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith('new-config')
  })

  it('前一次写入失败后仍继续执行最新写入，且只报告最新错误', async () => {
    const onError = vi.fn()
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('stale'))
      .mockRejectedValueOnce(new Error('latest'))
    const queue = createLatestMutationQueue()

    const firstRun = queue.enqueue({ task, onLatestError: onError })
    const secondRun = queue.enqueue({ task, onLatestError: onError })
    await Promise.all([firstRun, secondRun])

    expect(task).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: 'latest' })
  })

  it('可等待调用时已经排队的写入全部完成后再读取', async () => {
    const save = deferred<void>()
    const queue = createLatestMutationQueue()
    let idle = false

    void queue.enqueue({ task: () => save.promise })
    const waiting = queue.whenIdle().then(() => {
      idle = true
    })
    await Promise.resolve()
    expect(idle).toBe(false)

    save.resolve()
    await waiting
    expect(idle).toBe(true)
  })
})
