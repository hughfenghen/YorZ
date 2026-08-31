import { test, expect, type Page } from '@playwright/test'

/**
 * 折叠态的项目面板应当支持“悬停浮出”：鼠标停留 300ms 后浮层盖在正文之上，
 * 移开即收起，且整个过程不推挤右侧布局。悬停在窄轨的「展开」按钮上则不浮出——
 * 用户多半是想点它固定展开。
 */

/** 收起面板并返回折叠后的 aside 宽度（等 150ms 宽度过渡落定）。 */
async function collapseSidebar(page: Page): Promise<number> {
  const aside = page.locator('[data-testid="projects-sidebar"]')
  await expect(aside).toBeVisible({ timeout: 10_000 })
  const collapseBtn = page.locator('button[title="折叠项目面板"]')
  if (await collapseBtn.isVisible()) await collapseBtn.click()
  await expect(page.locator('button[title="展开项目面板"]')).toBeVisible()
  // 收起宽度是 w-9 = 36px；阈值卡在 40 以内，避免取到 150ms 过渡的中间值。
  await expect.poll(async () => (await aside.boundingBox())!.width).toBeLessThan(40)
  return (await aside.boundingBox())!.width
}

test.describe('项目面板悬停浮出', () => {
  test('折叠后悬停 300ms 浮出，移开收起，布局宽度不变', async ({ page }) => {
    await page.goto('/')

    const aside = page.locator('[data-testid="projects-sidebar"]')
    const panel = page.locator('[data-testid="projects-sidebar-panel"]')
    const collapsedWidth = await collapseSidebar(page)

    // 悬停：延迟未到时不应浮出。
    await aside.hover()
    await expect(panel).not.toHaveAttribute('data-peek', '1')

    // 超过 300ms 后浮出。
    await expect(panel).toHaveAttribute('data-peek', '1', { timeout: 2_000 })
    const peekBox = (await panel.boundingBox())!
    expect(peekBox.width).toBeGreaterThan(collapsedWidth + 60)

    // 浮层是绝对定位的覆盖层：aside 自身仍占折叠宽度，正文不位移。
    expect((await aside.boundingBox())!.width).toBeCloseTo(collapsedWidth, 0)

    // 移开鼠标即收起。
    await page.mouse.move(peekBox.x + peekBox.width + 200, peekBox.y + 200)
    await expect(panel).not.toHaveAttribute('data-peek', '1')
    expect((await aside.boundingBox())!.width).toBeCloseTo(collapsedWidth, 0)
  })

  test('悬停在「展开」按钮上不浮出，点击即固定展开', async ({ page }) => {
    await page.goto('/')

    const aside = page.locator('[data-testid="projects-sidebar"]')
    const panel = page.locator('[data-testid="projects-sidebar-panel"]')
    const expandBtn = page.locator('button[title="展开项目面板"]')
    const collapsedWidth = await collapseSidebar(page)

    // 停在按钮上远超 300ms，面板仍不浮出。
    await expandBtn.hover()
    await page.waitForTimeout(800)
    await expect(panel).not.toHaveAttribute('data-peek', '1')
    expect((await aside.boundingBox())!.width).toBeCloseTo(collapsedWidth, 0)

    // 按钮语义没被浮出偷换：点击后是常驻展开，不是浮层。
    await expandBtn.click()
    await expect(panel).not.toHaveAttribute('data-peek', '1')
    await expect
      .poll(async () => (await aside.boundingBox())!.width)
      .toBeGreaterThan(collapsedWidth + 60)
  })

  test('从「展开」按钮移到轨内其他位置后仍会浮出', async ({ page }) => {
    await page.goto('/')

    const aside = page.locator('[data-testid="projects-sidebar"]')
    const panel = page.locator('[data-testid="projects-sidebar-panel"]')
    const expandBtn = page.locator('button[title="展开项目面板"]')
    await collapseSidebar(page)

    await expandBtn.hover()
    await page.waitForTimeout(400)
    await expect(panel).not.toHaveAttribute('data-peek', '1')

    // 离开按钮但仍在窄轨内：重新计时并浮出。
    const asideBox = (await aside.boundingBox())!
    await page.mouse.move(asideBox.x + asideBox.width / 2, asideBox.y + asideBox.height - 40)
    await expect(panel).toHaveAttribute('data-peek', '1', { timeout: 2_000 })
  })
})
