import { createSignal, onCleanup } from 'solid-js'
import { subscribeConnectionState } from '@shared/api/sse.js'

/**
 * 与 YorZ Service 的实时通道（SSE）是否在线。
 *
 * 区别于 `network.ts` 的浏览器「网络离线」：这里反映「Service 进程是否还在应答」——
 * 服务意外中断时 EventSource 持续收不到心跳，SSE 看门狗判死后经本 signal 告知 UI。
 * 乐观初值 true，避免启动瞬间误报断连。
 */
const [connected, setConnected] = createSignal(true)

export { connected }

/** 在根组件挂载时调用；注销由 Solid 的 onCleanup 接管。 */
export function watchConnection(): void {
  const unsubscribe = subscribeConnectionState(setConnected)
  onCleanup(unsubscribe)
}
