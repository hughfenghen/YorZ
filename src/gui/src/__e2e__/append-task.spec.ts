import { test, expect } from '@playwright/test'
import { SPEC_ID } from './fixtures/setup.js'

test.describe.serial('append task popover', () => {
  test('点击「追加任务」按钮应弹出 popover 并落在按钮正下方且不越界', async ({ page }) => {
    await page.goto(`/specs/${SPEC_ID}`)

    const btn = page.locator('button.append-btn')
    await expect(btn).toBeVisible({ timeout: 5_000 })

    await btn.click()

    const dialog = page.locator('.append-dialog')
    await expect(dialog).toBeVisible()

    const viewport = page.viewportSize()
    const [btnBox, dialogBox] = await Promise.all([btn.boundingBox(), dialog.boundingBox()])
    expect(btnBox).not.toBeNull()
    expect(dialogBox).not.toBeNull()
    if (!btnBox || !dialogBox) return
    // 弹窗在按钮下方
    expect(dialogBox.y).toBeGreaterThan(btnBox.y + btnBox.height - 1)
    // 左缘对齐按钮左缘（视口足够时），或因夹取而更靠左，绝不在按钮右侧
    expect(dialogBox.x).toBeLessThanOrEqual(btnBox.x + 4)
    // 两侧均不越出视口
    expect(dialogBox.x).toBeGreaterThanOrEqual(0)
    if (viewport) {
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width)
    }
  })

  test('按 ESC 关闭 popover', async ({ page }) => {
    await page.goto(`/specs/${SPEC_ID}`)

    await page.locator('button.append-btn').click()
    const dialog = page.locator('.append-dialog')
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('提交追加项后 spec md 写入「## 追加任务」章节', async ({ page }) => {
    await page.goto(`/specs/${SPEC_ID}`)

    await page.locator('button.append-btn').click()
    const dialog = page.locator('.append-dialog')
    await expect(dialog).toBeVisible()

    await dialog.locator('input[type="radio"][value="fix"]').check()
    await dialog.locator('textarea').fill('e2e 追加项：按钮点击无响应的回归用例')

    const submitPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/specs/${SPEC_ID}/appends`) && res.request().method() === 'POST',
    )
    await dialog.locator('button[type="submit"]').click()
    const submitRes = await submitPromise
    expect(submitRes.status()).toBe(200)

    await expect(dialog).toHaveCount(0)

    const detail = await page.request.get(`/api/specs/${SPEC_ID}`)
    expect(detail.status()).toBe(200)
    const data = (await detail.json()) as { body: string; frontmatter: { stage: string } }
    expect(data.body).toContain('## 追加任务')
    expect(data.body).toContain('e2e 追加项：按钮点击无响应的回归用例')
    expect(data.frontmatter.stage).toBe('plan')
  })
})
