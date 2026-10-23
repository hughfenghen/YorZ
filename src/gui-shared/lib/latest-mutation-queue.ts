export interface LatestMutation<T> {
  task: () => Promise<T>
  onLatestSuccess?: (value: T) => void
  onLatestError?: (error: unknown) => void
}

/**
 * 串行执行整体覆写型 mutation，并且只允许最新一次操作回写 UI。
 *
 * 设置页的 PUT 会提交完整配置。若用户连续切换级联选项，并发请求会同时造成：
 * 1. 旧响应把新的乐观状态覆盖掉；2. 服务端按完成顺序落盘，旧请求可能后写。
 * 队列保证落盘顺序，latest revision 门禁保证界面不回退。
 */
export function createLatestMutationQueue(): {
  enqueue<T>(mutation: LatestMutation<T>): Promise<void>
  whenIdle(): Promise<void>
} {
  let tail: Promise<void> = Promise.resolve()
  let latestRevision = 0

  return {
    enqueue<T>(mutation: LatestMutation<T>): Promise<void> {
      const revision = ++latestRevision
      const result = tail.then(mutation.task)
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result.then(
        (value) => {
          if (revision === latestRevision) mutation.onLatestSuccess?.(value)
        },
        (error: unknown) => {
          if (revision === latestRevision) mutation.onLatestError?.(error)
        },
      )
    },
    whenIdle(): Promise<void> {
      return tail
    },
  }
}
