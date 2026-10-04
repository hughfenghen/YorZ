import { createSignal } from 'solid-js'
import { configureAuth } from '@shared/api/auth.js'

/**
 * 桌面端配对令牌引导（能力 URL / 持有令牌模型）。
 *
 * `yorz serve` 启动打印 `http://localhost:<port>/?token=<主令牌>`。桌面外壳加载时
 * 解析 `?token`，落入 `localStorage['yorz.token']` 后立即从地址栏抹除并留在干净首页；
 * 其后所有 `/api` 请求由共享层附加 `x-yorz-pair-token`。无令牌且收到 401 时，置位
 * `unauthorized` 信号，由 AppShell 提示用户改用启动日志里的带 token 链接打开。
 */

const TOKEN_KEY = 'yorz.token'

const [unauthorized, setUnauthorized] = createSignal(false)
export { unauthorized }

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function writeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // 隐私模式等禁用 localStorage 时静默降级（本次会话仍可用）。
  }
}

/**
 * 解析启动 URL 的 `?token` 并落盘，然后用 `history.replaceState` 抹除 token，
 * 最后注册共享层的令牌 provider 与 401 回调。应在首次渲染前调用一次。
 */
export function bootstrapAuth(): void {
  try {
    const url = new URL(window.location.href)
    const token = url.searchParams.get('token')
    if (token) {
      writeToken(token)
      setUnauthorized(false)
      url.searchParams.delete('token')
      const clean = url.pathname + (url.search ? url.search : '') + url.hash
      window.history.replaceState(window.history.state, '', clean)
    }
  } catch {
    // URL 解析失败不应阻断启动。
  }
  configureAuth({
    tokenProvider: readToken,
    onUnauthorized: () => setUnauthorized(true),
  })
}
