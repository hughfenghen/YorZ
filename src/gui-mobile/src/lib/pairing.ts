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

/** 启动时注册共享层令牌 provider 与 401 回调；应在首次渲染前调用一次。 */
export function initPairingAuth(): void {
  configureAuth({
    tokenProvider: () => deviceToken(),
    onUnauthorized: () => setDeviceToken(null),
  })
}
