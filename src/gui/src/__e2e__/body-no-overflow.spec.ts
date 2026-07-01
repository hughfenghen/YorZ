import { test, expect } from '@playwright/test'

test.describe('body 不允许出现垂直滚动条', () => {
  test('加载首页后 document.body 不产生垂直溢出', async ({ page }) => {
    await page.goto('/')

    await page.waitForLoadState('networkidle')

    const overflow = await page.evaluate(() => {
      const body = document.body
      const doc = document.documentElement
      return {
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        docScrollHeight: doc.scrollHeight,
        docClientHeight: doc.clientHeight,
      }
    })

    expect(overflow.bodyScrollHeight).toBe(overflow.bodyClientHeight)
    expect(overflow.docScrollHeight).toBe(overflow.docClientHeight)
  })
})
