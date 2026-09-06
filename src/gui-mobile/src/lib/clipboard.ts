/**
 * 复制文本，带 execCommand 回退。
 *
 * `navigator.clipboard` 只在 secure context（https / localhost）暴露，而移动端真机
 * 走的是 `http://<局域网 IP>:5174`——那里 `navigator.clipboard` 直接是 undefined。
 * 只用 Clipboard API 的话，「复制路径」在唯一的真机使用场景下 100% 失败，
 * 所以必须留着已废弃的 `document.execCommand('copy')` 这条路。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限被拒或非安全上下文：继续走下面的回退，不直接判失败
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  const el = document.createElement('textarea')
  el.value = text
  // 不能用 display:none / visibility:hidden——那样选区取不到内容，execCommand 会静默失败。
  // 固定定位到视口外并置零透明度，是这条老路的通行写法。
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.top = '0'
  el.style.left = '-9999px'
  el.style.opacity = '0'
  document.body.appendChild(el)
  try {
    el.select()
    // iOS 上 select() 对 readonly textarea 不生效，必须显式给选区
    el.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(el)
  }
}
