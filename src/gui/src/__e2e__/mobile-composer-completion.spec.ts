import { test, expect, type Page } from '@playwright/test'
import { SPEC_ID } from './fixtures/setup.js'

/**
 * 移动端输入框的 `/` 指令与 `@` 文件补全。
 *
 * 放在桌面 e2e 目录下是因为两端共用同一个 `serve` 与同一份种子数据（配置只有
 * 一个 project）；移动端形态靠视口 + `/m/` 前缀区分，不需要另起一套 harness。
 *
 * 覆盖的是共享状态机 `@shared/lib/completion.js` 的真实链路：触发判定 → 候选
 * 渲染 → 点选回填。桌面 `MentionTextarea` 跑的是同一份逻辑。
 */

/** iPhone 13 逻辑分辨率。 */
const MOBILE_VIEWPORT = { width: 390, height: 844 }

async function openMobileComposer(page: Page): Promise<void> {
  await page.setViewportSize(MOBILE_VIEWPORT)
  await page.goto('/m/sessions/new')
  await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 })
}

const bar = (page: Page) => page.getByTestId('completion-bar')
const items = (page: Page) => page.getByTestId('completion-item')

test.describe.serial('移动端输入框补全', () => {
  test('输入 `/` 弹出指令候选，点选后回填带前缀的文本', async ({ page }) => {
    await openMobileComposer(page)
    const input = page.locator('textarea')

    await input.click()
    await input.type('/')
    await expect(bar(page)).toBeVisible({ timeout: 5_000 })
    await expect(items(page).filter({ hasText: '/yorz-debug' })).toHaveCount(1)

    await items(page).filter({ hasText: '/yorz-debug' }).click()
    await expect(bar(page)).toBeHidden()
    // 前缀必须保留：服务端靠前导 `/name` 反查指令并注入 hiddenPrompt。
    await expect(input).toHaveValue('/yorz-debug ')
  })

  test('模糊匹配把前缀命中排在首位', async ({ page }) => {
    await openMobileComposer(page)
    const input = page.locator('textarea')

    await input.click()
    await input.type('/spec')
    await expect(bar(page)).toBeVisible({ timeout: 5_000 })
    await expect(items(page).first()).toContainText('/yorz-spec')
  })

  test('无匹配时给出提示而不是整条消失', async ({ page }) => {
    await openMobileComposer(page)
    const input = page.locator('textarea')

    await input.click()
    await input.type('/zzzz')
    await expect(bar(page)).toBeVisible({ timeout: 5_000 })
    await expect(bar(page)).toContainText('没有匹配的指令')
    await expect(items(page)).toHaveCount(0)
  })

  test('路径里的斜杠不触发指令', async ({ page }) => {
    await openMobileComposer(page)
    const input = page.locator('textarea')

    await input.click()
    // `/` 只在开头才是指令；这里的斜杠是路径分隔符，候选条不该出现。
    await input.type('看下 src/lib')
    await expect(bar(page)).toBeHidden()
  })

  test('输入 `@` 弹出文件路径候选，点选后插入 @path', async ({ page }) => {
    await openMobileComposer(page)
    const input = page.locator('textarea')

    await input.click()
    await input.type('@spec')
    // 防抖 280ms + 服务端现场目录遍历，给足时间。
    await expect(bar(page)).toBeVisible({ timeout: 8_000 })
    await expect(items(page).first()).toBeVisible()

    const picked = (await items(page).first().innerText()).trim()
    await items(page).first().click()
    await expect(bar(page)).toBeHidden()
    await expect(input).toHaveValue(`@${picked}`)
  })

  test('候选条位于输入框上方且不超出视口', async ({ page }) => {
    await openMobileComposer(page)
    const input = page.locator('textarea')

    await input.click()
    await input.type('/')
    await expect(bar(page)).toBeVisible({ timeout: 5_000 })

    const [barBox, inputBox] = await Promise.all([bar(page).boundingBox(), input.boundingBox()])
    expect(barBox).not.toBeNull()
    expect(inputBox).not.toBeNull()
    if (!barBox || !inputBox) return
    // 向上弹：候选条底缘不低于输入框顶缘。
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(inputBox.y + 1)
    expect(barBox.y).toBeGreaterThanOrEqual(0)
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1)
  })

  test('在候选项上按住并拖动不选中，松手后候选条仍在', async ({ page }) => {
    await openMobileComposer(page)
    const input = page.locator('textarea')

    await input.click()
    await input.type('/')
    await expect(bar(page)).toBeVisible({ timeout: 5_000 })

    const box = await items(page).first().boundingBox()
    expect(box).not.toBeNull()
    if (!box) return

    // 模拟「想滚动列表」的手势：按在候选项上往下拖再松手。
    // 位移超过阈值，抬起时必须判定为滚动而不是选中——这正是原实现（pointerdown
    // 即选中）踩的坑。
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 6 })
    await page.mouse.up()

    await expect(bar(page)).toBeVisible()
    await expect(input).toHaveValue('/')
  })
})

/**
 * 表单类输入框（新建 spec / 追加任务）只接 `@`，不接 `/`——与桌面端
 * `NewSpec` / `AppendTaskDialog` 同口径。
 */
test.describe.serial('移动端表单输入框补全', () => {
  test('新建 spec 的需求描述支持 @ 文件补全，且 / 不触发指令', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto('/m/specs/new')
    const input = page.locator('textarea')
    await expect(input).toBeVisible({ timeout: 10_000 })

    await input.click()
    await input.fill('')
    await input.type('/')
    await expect(bar(page)).toBeHidden()

    await input.fill('')
    await input.type('@spec')
    await expect(bar(page)).toBeVisible({ timeout: 8_000 })
    const picked = (await items(page).first().innerText()).trim()
    await items(page).first().click()
    await expect(bar(page)).toBeHidden()
    await expect(input).toHaveValue(`@${picked}`)
  })

  test('追加任务弹层的描述支持 @ 文件补全', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.goto(`/m/specs/${encodeURIComponent(SPEC_ID)}`)

    const openBtn = page.getByRole('button', { name: '追加任务' })
    await expect(openBtn).toBeVisible({ timeout: 10_000 })
    await openBtn.click()

    const input = page.locator('div[role="dialog"] textarea')
    await expect(input).toBeVisible()
    await input.click()
    await input.type('@spec')
    await expect(bar(page)).toBeVisible({ timeout: 8_000 })

    const picked = (await items(page).first().innerText()).trim()
    await items(page).first().click()
    await expect(bar(page)).toBeHidden()
    await expect(input).toHaveValue(`@${picked}`)
  })
})
