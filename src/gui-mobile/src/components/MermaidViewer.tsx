import { Show, createEffect, createSignal, onCleanup, type Component } from 'solid-js'
import { RotateCw } from 'lucide-solid'
import { t } from '@/i18n/index.js'

/**
 * 图表全屏查看器（移动端）。
 *
 * 与早期「铺满 + 系统 pinch-zoom 滚动」的版本不同，这里**完全接管触摸手势**：
 * 单指拖拽平移、单指轻点关闭、双指捏合缩放，并在打开时把图形**居中 + 适配缩放**。
 * 原因是单指拖拽、轻点关闭、横竖屏旋转这些诉求都要读取并裁决触摸轨迹，和系统
 * `touch-action: pinch-zoom` 不可能共存——单指会被原生滚动吞掉、轻点无法从滚动里
 * 分离。于是 stage 层 `touch-action: none`，所有变换自绘。
 *
 * DOM 分两层：
 * 1. stage 层：承载注入的 SVG（holder 上套 `transform: translate scale rotate`），
 *    监听 touch 做 pan / pinch / tap。
 * 2. 控件层：stage 的兄弟节点，不在 transform 内，故关闭 / 横屏按钮的尺寸与位置
 *    恒定，不随图形缩放旋转变化。
 *
 * 传进来的是 SVG 的 outerHTML 字符串（克隆），用 `innerHTML` 注入即可，无需像桌面端
 * 那样搬运原节点、维护原位插回快照。
 */

const MIN_SCALE = 0.25
const MAX_SCALE = 8
/** 初始适配时的缩放上限：小图不至于被放得失真。 */
const MAX_INITIAL_SCALE = 2.5
/** 适配时四周留白（px）。 */
const FIT_PADDING = 32
/** 判定轻点 vs 拖动的位移阈值，与 long-press 同口径。 */
const TAP_MOVE_TOLERANCE = 10
/** 轻点的最长时长（ms）；超过视为按住，不触发关闭。 */
const TAP_MAX_MS = 300

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function parsePositiveNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** 取 SVG 的自然显示尺寸：优先实测，退化到 viewBox，再退化到 width/height 属性。 */
function getSvgDisplaySize(svg: SVGSVGElement): { width: number; height: number } {
  const rect = svg.getBoundingClientRect()
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height }
  }
  const viewBox = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (viewBox?.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) {
    return { width: viewBox[2]!, height: viewBox[3]! }
  }
  return {
    width: parsePositiveNumber(svg.getAttribute('width')) ?? 0,
    height: parsePositiveNumber(svg.getAttribute('height')) ?? 0,
  }
}

export const MermaidViewer: Component<{
  /** 非空即打开；内容是 `<svg>…</svg>` 的 outerHTML。 */
  svg: string | null
  onClose: () => void
}> = (props) => {
  const [scale, setScale] = createSignal(1)
  const [tx, setTx] = createSignal(0)
  const [ty, setTy] = createSignal(0)
  const [rotation, setRotation] = createSignal<0 | 90>(0)

  let stageRef: HTMLDivElement | undefined
  let holderRef: HTMLDivElement | undefined
  // 自然尺寸（scale=1、未旋转时的像素尺寸），测量一次后复用于每次 fit。
  let naturalW = 0
  let naturalH = 0

  // 手势临时状态（非响应式：不需要驱动渲染，只在事件回调间传递）。
  let mode: 'none' | 'pan' | 'pinch' = 'none'
  let startX = 0
  let startY = 0
  let startTx = 0
  let startTy = 0
  let startTime = 0
  let moved = false
  let startDist = 0
  let startScale = 1
  let startMidX = 0
  let startMidY = 0

  const transform = () =>
    `translate(${tx()}px, ${ty()}px) scale(${scale()}) rotate(${rotation()}deg)`

  /** 按当前旋转态把图形适配到 stage 并居中（translate 归零即居中）。 */
  function applyFit() {
    const stage = stageRef
    if (!stage) return
    const r = stage.getBoundingClientRect()
    const rotated = rotation() === 90
    const w = rotated ? naturalH : naturalW
    const h = rotated ? naturalW : naturalH
    if (w <= 0 || h <= 0 || r.width <= 0 || r.height <= 0) {
      setScale(1)
      setTx(0)
      setTy(0)
      return
    }
    const fit = Math.min((r.width - FIT_PADDING) / w, (r.height - FIT_PADDING) / h)
    setScale(clamp(fit, MIN_SCALE, MAX_INITIAL_SCALE))
    setTx(0)
    setTy(0)
  }

  // 打开 / 切换图形：复位变换后，下一帧测量自然尺寸再 fit（innerHTML 注入后需等布局）。
  createEffect(() => {
    const svg = props.svg
    if (!svg) return
    setRotation(0)
    setScale(1)
    setTx(0)
    setTy(0)
    const raf = requestAnimationFrame(() => {
      const el = holderRef?.querySelector('svg')
      if (!el) return
      const size = getSvgDisplaySize(el)
      naturalW = size.width
      naturalH = size.height
      applyFit()
    })
    onCleanup(() => cancelAnimationFrame(raf))
  })

  function toggleOrientation() {
    setRotation((r) => (r === 0 ? 90 : 0))
    applyFit()
  }

  function midRelCenter(aX: number, aY: number, bX: number, bY: number) {
    const stage = stageRef
    const midX = (aX + bX) / 2
    const midY = (aY + bY) / 2
    if (!stage) return { x: midX, y: midY, px: 0, py: 0 }
    const r = stage.getBoundingClientRect()
    return { x: midX, y: midY, px: midX - (r.left + r.width / 2), py: midY - (r.top + r.height / 2) }
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      mode = 'pan'
      const t0 = e.touches[0]!
      startX = t0.clientX
      startY = t0.clientY
      startTx = tx()
      startTy = ty()
      startTime = performance.now()
      moved = false
    } else if (e.touches.length === 2) {
      mode = 'pinch'
      const a = e.touches[0]!
      const b = e.touches[1]!
      startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      startScale = scale()
      const mid = midRelCenter(a.clientX, a.clientY, b.clientX, b.clientY)
      startMidX = mid.px
      startMidY = mid.py
      startTx = tx()
      startTy = ty()
      moved = true // 捏合不会被误判成轻点
    }
  }

  function onTouchMove(e: TouchEvent) {
    e.preventDefault()
    if (mode === 'pan' && e.touches.length === 1) {
      const t0 = e.touches[0]!
      const dx = t0.clientX - startX
      const dy = t0.clientY - startY
      if (!moved && Math.hypot(dx, dy) > TAP_MOVE_TOLERANCE) moved = true
      setTx(startTx + dx)
      setTy(startTy + dy)
    } else if (mode === 'pinch' && e.touches.length >= 2) {
      const a = e.touches[0]!
      const b = e.touches[1]!
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      if (startDist <= 0) return
      const next = clamp(startScale * (dist / startDist), MIN_SCALE, MAX_SCALE)
      // 以起始双指中点为锚做 translate 修正，让该点在缩放时保持不动。
      setTx(startMidX - ((startMidX - startTx) / startScale) * next)
      setTy(startMidY - ((startMidY - startTy) / startScale) * next)
      setScale(next)
    }
  }

  function onTouchEnd(e: TouchEvent) {
    if (mode === 'pan' && !moved && e.touches.length === 0) {
      if (performance.now() - startTime < TAP_MAX_MS) {
        // 关键：阻止浏览器在同坐标派发的合成 click。否则 onClose() 关闭预览后，
        // 这个合成 click 会穿透到下方页面，若正好命中 .mermaid 会重新打开预览，
        // 表现为「单击关不掉」。touchend 以 {passive:false} 绑定，preventDefault 有效。
        e.preventDefault()
        mode = 'none'
        props.onClose()
        return
      }
    }
    if (e.touches.length === 0) {
      mode = 'none'
    } else if (e.touches.length === 1) {
      // 捏合松开一指 → 退回单指拖拽（但不再是轻点候选）。
      const t0 = e.touches[0]!
      mode = 'pan'
      startX = t0.clientX
      startY = t0.clientY
      startTx = tx()
      startTy = ty()
      startTime = performance.now()
      moved = true
    }
  }

  function onTouchCancel() {
    mode = 'none'
  }

  // 手动绑定 touch 监听：Solid 会把 touch 事件委托到 document（默认 passive），
  // 届时 preventDefault 失效且告警。用 ref 直接 addEventListener({passive:false})。
  const attachStage = (el: HTMLDivElement) => {
    stageRef = el
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    el.addEventListener('touchcancel', onTouchCancel, { passive: false })
    onCleanup(() => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
    })
  }

  return (
    <Show when={props.svg}>
      {(svg) => (
        <div
          class="fixed inset-0 z-[70] overflow-hidden bg-background"
          role="dialog"
          aria-modal="true"
          aria-label={t('specDetail.viewDiagram')}
        >
          {/* stage：全屏手势区，图形在其内 flex 居中（配合 translate 归零即居中）。 */}
          <div
            ref={attachStage}
            class="absolute inset-0 flex items-center justify-center"
            style={{ 'touch-action': 'none' }}
          >
            <div
              ref={holderRef}
              class="origin-center will-change-transform [&>svg]:block [&>svg]:h-auto [&>svg]:max-w-none"
              style={{ transform: transform() }}
              // eslint-disable-next-line solid/no-innerhtml -- 内容是 mermaid 自己渲染出的 SVG，未经用户输入拼接
              innerHTML={svg()}
            />
          </div>

          {/* 控件层：在 transform 之外，尺寸位置恒定，不随图形缩放旋转变化。 */}
          {/* 关闭靠单击图形（tap）即可，不再放常驻关闭 icon；此处仅保留横屏切换。 */}
          <div class="absolute right-0 top-0 flex items-center gap-3 px-3 pt-safe">
            <button
              type="button"
              class="tap-target flex items-center justify-center text-muted-foreground active:opacity-60"
              aria-label={t('specDetail.toggleOrientation')}
              onClick={toggleOrientation}
            >
              <RotateCw size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </Show>
  )
}
