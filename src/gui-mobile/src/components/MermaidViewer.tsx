import { Show, type Component } from 'solid-js'
import { X } from 'lucide-solid'
import { t } from '@/i18n/index.js'

/**
 * 图表全屏查看器。
 *
 * 只做「铺满 + 可缩放滚动」，缩放本身交给系统双指手势（`touch-action: pinch-zoom`）。
 * 桌面那套 230 行的 overlay 是滚轮缩放 + 指针拖拽平移 + hover 出按钮，在触屏上
 * 三个前提全部不成立；自绘一套缩放数学去和系统手势抢事件，只会得到一个比原生
 * 手感更差、还会打架的版本。
 *
 * 传进来的是 SVG 的 outerHTML 而不是节点本身：把正文里那个已渲染的节点搬过来，
 * 关闭时要原位插回去（桌面端为此维护了 parent/nextSibling 快照），而 morphdom
 * 随时可能在这中间刷新正文——克隆一份是这里唯一不会打架的做法。
 */
export const MermaidViewer: Component<{
  /** 非空即打开；内容是 `<svg>…</svg>` 的 outerHTML。 */
  svg: string | null
  onClose: () => void
}> = (props) => (
  <Show when={props.svg}>
    {(svg) => (
      <div
        class="fixed inset-0 z-[70] flex flex-col bg-background pt-safe pb-safe"
        role="dialog"
        aria-modal="true"
        aria-label={t('specDetail.viewDiagram')}
      >
        <header class="flex shrink-0 justify-end px-2 py-1">
          <button
            type="button"
            class="tap-target flex items-center justify-center rounded-md text-muted-foreground active:bg-accent"
            aria-label={t('common.close')}
            onClick={() => props.onClose()}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div
          class="min-h-0 flex-1 overflow-auto p-4 [&>svg]:h-auto [&>svg]:max-w-none"
          style={{ 'touch-action': 'pinch-zoom' }}
          // eslint-disable-next-line solid/no-innerhtml -- 内容是 mermaid 自己渲染出的 SVG，未经用户输入拼接
          innerHTML={svg()}
        />
      </div>
    )}
  </Show>
)
