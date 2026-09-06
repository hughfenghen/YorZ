import { Show, type Component } from 'solid-js'
import { X } from 'lucide-solid'
import type { SelectionSnapshot } from '@shared/lib/selection.js'
import { t } from '@/i18n/index.js'

/**
 * 正文选区的动作条：**屏幕底部固定条**，而不是桌面端那种跟随选区的浮动菜单。
 *
 * iOS 的 callout 气泡与 Android Chrome 的浮动工具条都是原生浮层，贴着选区
 * 出现且 z-index 压不过；任何跟随选区的自绘菜单都必然与它重叠，且这不是调
 * 偏移量能绕开的——空间不足时原生浮层会自己翻边。固定在底部就不和它争位置，
 * 顺带消掉三个桌面遗留缺陷：滚动后 rect 过期、iOS visualViewport 与
 * layoutViewport 不一致导致 `fixed` 错位、菜单宽度硬编码带来的横向 clamp。
 *
 * `z-50` 与 Toast 同层但互不遮挡（Toast 是 pointer-events-none 的贴底容器），
 * 低于 Sheet / ActionSheet 的 `z-[60]`，弹层打开时天然被压住。
 */
export const SelectionBar: Component<{
  snap: SelectionSnapshot | null
  onAnnotate: (snap: SelectionSnapshot) => void
  onExplain: (snap: SelectionSnapshot) => void
  onClose: () => void
}> = (props) => (
  <Show when={props.snap}>
    {(snap) => (
      <div
        // 两层：外层只吃安全区，内层给视觉内边距。安全区工具类在产物 CSS 中排在
        // Tailwind 的 p* 之后，写在同一元素上是覆盖而非叠加——没有刘海的设备上
        // max(env(...),0) 取 0，内边距会被整个吃掉，按钮直接贴边。
        class="animate-in slide-in-from-bottom-4 fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card shadow-lg duration-150 px-safe pb-safe"
        role="toolbar"
        aria-label={t('specDetail.annotate')}
      >
        <div class="flex items-center gap-3 px-2 py-2">
          {/*
          两道保险保住选区：
          1. `onPointerDown` 阻止默认行为，按下时不清空 selection；
          2. 所有动作只读**已冻结的快照**，从不回头读 live selection —— 即便
             第 1 条在某些 WebView 上失效，250ms 的去抖也足够让 click 先跑完。
        */}
          <button
            type="button"
            class="min-h-11 flex-1 rounded-lg text-sm active:bg-accent"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => props.onAnnotate(snap())}
          >
            {t('specDetail.annotate')}
          </button>
          <button
            type="button"
            class="min-h-11 flex-1 rounded-lg text-sm active:bg-accent"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => props.onExplain(snap())}
          >
            {t('specDetail.explain')}
          </button>
          <button
            type="button"
            class="tap-target flex shrink-0 items-center justify-center text-muted-foreground active:opacity-60"
            aria-label={t('specDetail.selectionClose')}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => props.onClose()}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
    )}
  </Show>
)
