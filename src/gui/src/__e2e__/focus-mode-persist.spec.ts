import { test, expect } from '@playwright/test'
import { SPEC_ID } from './fixtures/setup.js'

async function resolveProjectId(
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const res = await request.get('/api/projects')
  expect(res.status()).toBe(200)
  const list = (await res.json()) as
    | { projects: Array<{ id: string; name?: string }> }
    | Array<{ id: string; name?: string }>
  const arr = Array.isArray(list) ? list : list.projects
  expect(arr.length).toBeGreaterThan(0)
  return (arr.find((p) => p.name === '.tmp-e2e') ?? arr[0]!).id
}

/**
 * SpecList / SpecDetail / SpecReview / SpecDebug 共用同一块主区域，客户端路由
 * 互切不应改变「最大化（focus mode）」状态；只有离开这组页面才退出最大化。
 * 必须用页内链接跳转（整页 goto 会重置模块状态，测不到这个 bug）。
 */
test.describe.serial('focus mode 跨路由保持', () => {
  test('SpecList → SpecDetail → SpecReview → SpecList 保持最大化', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    const focusBtn = page.locator('button[aria-pressed]')

    await page.goto(`/${pid}`)
    await expect(focusBtn).toBeVisible({ timeout: 5_000 })
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'false')

    await focusBtn.click()
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'true')

    // SpecList → SpecDetail（点卡片链接，客户端路由）
    await page.locator(`a[href="/${pid}/specs/${SPEC_ID}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/specs/${SPEC_ID.replace(/\./g, '\\.')}$`))
    await expect(focusBtn).toBeVisible({ timeout: 5_000 })
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'true')

    // SpecDetail → SpecReview
    await page.locator(`a[href="/${pid}/specs/${SPEC_ID}/review"]`).first().click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(focusBtn).toBeVisible({ timeout: 5_000 })
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'true')

    // SpecReview → SpecList（面包屑）
    await page.locator(`a[href="/${pid}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/${pid}$`))
    await expect(focusBtn).toBeVisible({ timeout: 5_000 })
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('离开该组页面（新建 Spec）后退出最大化', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    const focusBtn = page.locator('button[aria-pressed]')

    await page.goto(`/${pid}`)
    await expect(focusBtn).toBeVisible({ timeout: 5_000 })
    await focusBtn.click()
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'true')

    // NewSpec 不参与 focus mode（页面上没有退出按钮），离开后必须还原 chrome。
    await page.locator(`a[href="/${pid}/specs/new"]`).first().click()
    await expect(page).toHaveURL(/\/specs\/new$/)
    await expect(focusBtn).toHaveCount(0, { timeout: 5_000 })

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/${pid}$`))
    await expect(focusBtn).toBeVisible({ timeout: 5_000 })
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'false')
  })
})
