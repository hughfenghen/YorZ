import { describe, expect, it, vi } from 'vitest'
import { createTapSelect } from '../tap-select.js'

/** 只带手势判定用得上的字段；`createTapSelect` 不碰其余 PointerEvent 成员。 */
function pointer(
  pointerId: number,
  x: number,
  y: number,
  extra: Partial<PointerEvent> = {},
): PointerEvent {
  return {
    pointerId,
    clientX: x,
    clientY: y,
    button: 0,
    preventDefault: () => {},
    ...extra,
  } as unknown as PointerEvent
}

describe('createTapSelect', () => {
  it('原地按下抬起判定为轻触，并抑制后续合成事件', () => {
    const onTap = vi.fn()
    const preventDefault = vi.fn()
    const h = createTapSelect({ onTap })

    h.onPointerDown(pointer(1, 100, 100))
    h.onPointerUp(pointer(1, 102, 103, { preventDefault }))

    expect(onTap).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  // 回归点：这条正是「想滚动列表却被选中」的原始缺陷。
  it('位移超过阈值视为滚动，抬起时不选中', () => {
    const onTap = vi.fn()
    const preventDefault = vi.fn()
    const h = createTapSelect({ onTap })

    h.onPointerDown(pointer(1, 100, 100))
    h.onPointerMove(pointer(1, 100, 140))
    h.onPointerUp(pointer(1, 100, 140, { preventDefault }))

    expect(onTap).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('pointercancel 后抬起不再触发', () => {
    const onTap = vi.fn()
    const h = createTapSelect({ onTap })

    h.onPointerDown(pointer(1, 10, 10))
    h.onPointerCancel()
    h.onPointerUp(pointer(1, 10, 10))

    expect(onTap).not.toHaveBeenCalled()
  })

  it('只认最先按下的那根手指，其余指针的移动与抬起都被忽略', () => {
    const onTap = vi.fn()
    const h = createTapSelect({ onTap })

    h.onPointerDown(pointer(1, 50, 50))
    // 第二根手指划得再远也不该作废第一根的起点
    h.onPointerMove(pointer(2, 50, 300))
    h.onPointerUp(pointer(2, 50, 300))
    expect(onTap).not.toHaveBeenCalled()

    h.onPointerUp(pointer(1, 50, 52))
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('非主按键不进入判定', () => {
    const onTap = vi.fn()
    const h = createTapSelect({ onTap })

    h.onPointerDown(pointer(1, 10, 10, { button: 2 }))
    h.onPointerUp(pointer(1, 10, 10))

    expect(onTap).not.toHaveBeenCalled()
  })

  it('轻触后的 touchend 被拦下，滚动收尾的 touchend 放行', () => {
    const onTap = vi.fn()
    const h = createTapSelect({ onTap })
    const tapEnd = { cancelable: true, preventDefault: vi.fn() } as unknown as TouchEvent
    const scrollEnd = { cancelable: true, preventDefault: vi.fn() } as unknown as TouchEvent

    h.onPointerDown(pointer(1, 10, 10))
    h.onPointerUp(pointer(1, 10, 10))
    h.onTouchEnd(tapEnd)
    expect(tapEnd.preventDefault).toHaveBeenCalledTimes(1)

    h.onPointerDown(pointer(1, 10, 10))
    h.onPointerMove(pointer(1, 10, 90))
    h.onPointerUp(pointer(1, 10, 90))
    h.onTouchEnd(scrollEnd)
    expect(scrollEnd.preventDefault).not.toHaveBeenCalled()
  })
})
