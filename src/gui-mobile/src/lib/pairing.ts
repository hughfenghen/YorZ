import { createSignal } from 'solid-js'
import { configureAuth } from '@shared/api/auth.js'
import { api } from '@shared/api/index.js'

/**
 * 移动端设备令牌（能力 URL / 持有令牌模型）。
 *
 * 手机经配对码换取各自的设备令牌，持久化于 `localStorage['yorz.m.token']`，信号化以便
 * AppShell 守卫响应式跳转。所有 `/api` 请求由共享层附加 `x-yorz-pair-token`；令牌失效
 * （服务端 401）时清除令牌 —— 守卫 effect 据此自动跳回 `/pair`。
 */

const TOKEN_KEY = 'yorz.m.token'

function readStored(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeStored(token: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // localStorage 不可用时静默降级（本次会话内令牌仍在内存信号中）。
  }
}

const [deviceToken, setDeviceTokenSignal] = createSignal<string | null>(readStored())

export { deviceToken }

export function isPaired(): boolean {
  return !!deviceToken()
}

export function setDeviceToken(token: string | null): void {
  setDeviceTokenSignal(token)
  writeStored(token)
}

/** 以配对码换取设备令牌并持久化；失败抛错由调用方处理。 */
export async function claimPairing(code: string): Promise<void> {
  const { token } = await api.claimPairing(code.trim())
  setDeviceToken(token)
}

function wireAuth(): void {
  configureAuth({
    tokenProvider: () => deviceToken(),
    onUnauthorized: () => setDeviceToken(null),
  })
}

// 关键时序：必须在**模块求值期**（import 副作用）就注册 provider/401 回调，
// 而不能等到 main.tsx 函数体里再调用——否则会被下面这条竞态击穿：
//   ES import 先于函数体执行，`lib/active-project.ts` 顶层的 `createResource`
//   会在其模块求值时立即发起 `GET /api/projects`。若此刻 provider 仍是共享层
//   默认的 `() => null`，该请求不带令牌 → 401；而 401 响应异步回来时，函数体里的
//   `initPairingAuth()` 早已把 `onUnauthorized` 配好 → 把刚持久化的有效设备令牌清掉，
//   于是每次刷新/重进都被踢回 /pair。
// pairing.ts 在 main.tsx 中先于 AppShell/页面（含 active-project）导入，故此处的
// import 副作用能保证「provider 就绪」早于任何 /api 请求发出。
wireAuth()

/** 保留显式入口（幂等）；真正的注册已在模块导入时完成。 */
export function initPairingAuth(): void {
  wireAuth()
}
