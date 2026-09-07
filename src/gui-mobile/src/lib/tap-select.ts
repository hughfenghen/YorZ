/** 判定为轻触所允许的手指位移，与 `long-press.ts` 的 `moveTolerance` 同口径。 */
const DEFAULT_MOVE_TOLERANCE_PX = 10

interface TapSelectOptions {
  /** 判定为轻触时触发。 */
  onTap: () => void
  /** 判定期间允许的位移，超过即视为滚动意图，默认 10px。 */
  moveTolerance?: number
}

/**
 * 「抬起才算选中」的轻触手势。返回一组可展开到元素上的处理器：
 * `<button {...createTapSelect({ onTap })}>`。
 *
 * 存在的理由是补全候选条那种「铺满整行的按钮 + 可滚动的列表」组合：
 *
 * 1. **动作必须晚于 pointerdown**。在 pointerdown 里 preventDefault 会连带取消
 *    touchstart 的默认行为（iOS 的 pointer 事件由 touch 事件派生），列表就再也
 *    滚不动了；在 pointerdown 里直接执行动作更糟——手指刚碰上就已经选中。
 * 2. **动作又必须早于 click**。候选条挂在软键盘上方，焦点一迁移键盘收起、布局
 *    回落，此时才到的 click 会落到错位的那一项。pointerup 正好卡在两者之间：
 *    滚动手势已经能被位移判据排除，而合成的 mousedown / focus / click 还没发生。
 * 3. **只对轻触抑制合成事件**。轻触时 preventDefault 以免浏览器补发 click 并
 *    迁移焦点；滚动收尾的那一下**不能**拦，否则可能打断惯性滚动。
 *
 * `touchend` 在 WebKit 上晚于 pointerup 派发，够不着 pointerup 里已经清掉的起点，
 * 所以用一个独立的 `wasTap` 标记把「这一次要不要拦」传过去。
 */
export function createTapSelect(options: TapSelectOptions) {
  let origin: { id: number; x: number; y: number } | null = null
  /** 供随后到达的 touchend 读取：刚刚那次抬起是否被判定为轻触。 */
  let wasTap = false

  const tolerance = () => options.moveTolerance ?? DEFAULT_MOVE_TOLERANCE_PX

  /** 同一次手势里只认最先按下的那根手指，多指时其余指针一律忽略。 */
  const isTracked = (e: PointerEvent) => origin != null && origin.id === e.pointerId

  return {
    onPointerDown: (e: PointerEvent) => {
      // 只认主按键：桌面右键有原生菜单，不该被当成选中。
      if (e.button !== 0) return
      wasTap = false
      origin = { id: e.pointerId, x: e.clientX, y: e.clientY }
    },
    onPointerMove: (e: PointerEvent) => {
      if (!isTracked(e)) return
      const tol = tolerance()
      if (Math.abs(e.clientX - origin!.x) > tol || Math.abs(e.clientY - origin!.y) > tol) {
        origin = null
      }
    },
    onPointerUp: (e: PointerEvent) => {
      if (!isTracked(e)) return
      const tol = tolerance()
      const moved = Math.abs(e.clientX - origin!.x) > tol || Math.abs(e.clientY - origin!.y) > tol
      origin = null
      if (moved) return
      wasTap = true
      e.preventDefault()
      options.onTap()
    },
    // 浏览器接管为滚动 / 系统手势时到达；不归零的话残留起点会让下一次抬起误判。
    onPointerCancel: () => {
      origin = null
      wasTap = false
    },
    onTouchEnd: (e: TouchEvent) => {
      if (!wasTap) return
      wasTap = false
      // cancelable 为 false 说明浏览器已提交默认行为（多见于滚动中），拦也没用。
      if (e.cancelable) e.preventDefault()
    },
  }
}
