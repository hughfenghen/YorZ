import { createSignal, onCleanup } from 'solid-js'

/** 移动端断点：< 768px（Tailwind md 档），与技术方案对齐，桌面三栏布局保持不变。 */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)'

/** SSR / 无 matchMedia 环境下安全取值。 */
export function matchesMediaQuery(query: string): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(query).matches
}

/**
 * 响应式媒体查询 signal：返回一个随视口/系统偏好变化而更新的读取函数。
 * 参照 lib/theme.ts 的 matchMedia 监听模式；组件卸载时自动解除监听。
 */
export function createMediaQuery(query: string): () => boolean {
  const [matches, setMatches] = createSignal(matchesMediaQuery(query))
  if (typeof window === 'undefined' || !window.matchMedia) return matches
  const mql = window.matchMedia(query)
  const onChange = (event: MediaQueryListEvent): void => {
    setMatches(event.matches)
  }
  // 旧版 Safari 只有 addListener，做能力兜底。
  if (mql.addEventListener) mql.addEventListener('change', onChange)
  else mql.addListener(onChange)
  onCleanup(() => {
    if (mql.removeEventListener) mql.removeEventListener('change', onChange)
    else mql.removeListener(onChange)
  })
  return matches
}
