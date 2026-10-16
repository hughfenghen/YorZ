import { createSignal, onCleanup } from 'solid-js'
import { subscribeConnectionState } from './sse.js'

/**
 * 与 YorZ Service 的实时通道（SSE）是否在线。
 *
 * 区别于浏览器「网络离线」：这里反映的是「Service 进程是否还在应答」——服务意外
 * 中断时，EventSource 会持续收不到心跳，SSE 看门狗据此判死并经本 signal 告知 UI。
 * 乐观初值 true，避免启动瞬间误报断连。
 */
const [connected, setConnected] = createSignal(true)

export { connected }

/** 在组件作用域内调用；注销由 Solid 的 onCleanup 接管。 */
export function watchConnection(): void {
  const unsubscribe = subscribeConnectionState(setConnected)
  onCleanup(unsubscribe)
}
