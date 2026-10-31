import { Show, type Component } from 'solid-js'
import { X } from 'lucide-solid'

/**
 * 移动端图片灯箱。
 *
 * 移动端没有桌面那套 Kobalte `Dialog`（`gui-mobile` 的 `ui/` 只有 button），因此
 * 这里用一个自包含的 `fixed inset-0` 全屏 overlay 做等价实现，签名与桌面
 * `ImagePreview`（`{ src?; alt?; open; onOpenChange }`）对齐，供两端统一调用。
 *
 * 交互刻意保持轻量：`<img object-contain>` 最大化显示原图，点遮罩或右上角按钮关闭，
 * 缩放交给系统（`touch-action: pinch-zoom`）——比 `MermaidViewer` 自绘 pan/pinch 轻，
 * 已满足「看原图」诉求；图片本体 `touch-action: none` 避免点击穿透误触关闭。
 */
export const ImagePreview: Component<{
  src?: string
  alt?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}> = (props) => {
  return (
    <Show when={props.open && props.src}>
      <div
        class="fixed inset-0 z-[70] flex items-center justify-center bg-background/90 p-4"
        style={{ 'touch-action': 'pinch-zoom' }}
        onClick={() => props.onOpenChange(false)}
      >
        <img
          src={props.src}
          alt={props.alt ?? ''}
          class="max-h-full max-w-full rounded-lg object-contain shadow-lg"
          style={{ 'touch-action': 'none' }}
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          class="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-foreground shadow"
          aria-label="Close"
          onClick={(e) => {
            e.stopPropagation()
            props.onOpenChange(false)
          }}
        >
          <X class="h-5 w-5" />
        </button>
      </div>
    </Show>
  )
}
