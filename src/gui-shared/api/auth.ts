/**
 * 配对鉴权令牌的前端注入点（能力 URL / 持有令牌模型）。
 *
 * 共享层对令牌来源无感知：桌面端从 `localStorage['yorz.token']`（启动 URL 引导），
 * 移动端从设备令牌 store 注入。两端在入口处调用 {@link configureAuth} 注册
 * `tokenProvider` 与 `onUnauthorized`；api 层据此给请求附加 `x-yorz-pair-token`
 * 头（SSE/EventSource 无法设头，改用 `?token=` query），并在 401 时回调。
 */

const PAIR_TOKEN_HEADER = 'x-yorz-pair-token'

let tokenProvider: () => string | null = () => null
let unauthorizedHandler: () => void = () => {}

export interface AuthConfig {
  /** 返回当前令牌或 null（无令牌时请求不附加鉴权信息）。 */
  tokenProvider?: () => string | null
  /** 服务端返回 401 时触发（如清除令牌并跳配对页）。 */
  onUnauthorized?: () => void
}

export function configureAuth(config: AuthConfig): void {
  if (config.tokenProvider) tokenProvider = config.tokenProvider
  if (config.onUnauthorized) unauthorizedHandler = config.onUnauthorized
}

export function getAuthToken(): string | null {
  try {
    return tokenProvider()
  } catch {
    return null
  }
}

export function notifyUnauthorized(): void {
  try {
    unauthorizedHandler()
  } catch {
    // 回调抛错不应影响请求流程。
  }
}

/** 给 fetch init 附加鉴权头（有令牌时）。保留调用方已设置的其它头。 */
export function withAuthHeaders(init?: RequestInit): RequestInit {
  const token = getAuthToken()
  if (!token) return init ?? {}
  const headers = new Headers(init?.headers)
  headers.set(PAIR_TOKEN_HEADER, token)
  return { ...init, headers }
}

/** 给 URL 追加 `token` query（供无法设头的 EventSource 使用）。 */
export function appendAuthToken(url: string): string {
  const token = getAuthToken()
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}
