import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { createVisualViewport } from '../visual-viewport.js'

describe('createVisualViewport', () => {
  it('无 visualViewport 环境（node/SSR）返回安全默认值', () => {
    createRoot((dispose) => {
      const vv = createVisualViewport()
      expect(vv().offsetTop).toBe(0)
      expect(vv().offsetLeft).toBe(0)
      expect(vv().keyboardOpen).toBe(false)
      expect(vv().height).toBe(0)
      dispose()
    })
  })
})
