import { test, expect } from '@playwright/test'
import { NO_REVIEW_SPEC_ID, TASK_LIST_SPEC_ID } from './fixtures/setup.js'

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
  // Select the seeded .tmp-e2e project explicitly: with several registered
  // projects `arr[0]` is not necessarily the e2e temp project.
  return (arr.find((p) => p.name === '.tmp-e2e') ?? arr[0]!).id
}

test.describe.serial('markdown GFM task list rendering', () => {
  test('SpecDetail 渲染 `- [ ]` / `- [x]` 为 checkbox 且 disabled', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}/specs/${TASK_LIST_SPEC_ID}`)

    const main = page.locator('article.markdown.spec-main')
    await expect(main).toBeVisible({ timeout: 5_000 })

    const checkboxes = main.locator('input.task-list-item-checkbox')
    await expect(checkboxes).toHaveCount(3)

    const checkedCount = await main.locator('input.task-list-item-checkbox:checked').count()
    expect(checkedCount).toBe(2)

    const disabledCount = await main.locator('input.task-list-item-checkbox[disabled]').count()
    expect(disabledCount).toBe(3)

    const taskItems = await main.locator('li.task-list-item').count()
    expect(taskItems).toBe(3)

    const plainItems = await main.locator('li:not(.task-list-item)').count()
    expect(plainItems).toBeGreaterThanOrEqual(1)
  })

  test('SpecReview 渲染 review.md 中的 task list 为 checkbox', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}/specs/${TASK_LIST_SPEC_ID}/review`)

    const reviewBody = page.locator('article.markdown.review-md')
    await expect(reviewBody).toBeVisible({ timeout: 5_000 })

    const checkboxes = reviewBody.locator('input.task-list-item-checkbox')
    await expect(checkboxes).toHaveCount(2)

    const checkedCount = await reviewBody.locator('input.task-list-item-checkbox:checked').count()
    expect(checkedCount).toBe(1)

    const disabledCount = await reviewBody
      .locator('input.task-list-item-checkbox[disabled]')
      .count()
    expect(disabledCount).toBe(2)
  })

  test('SpecReview 在 review.md 不存在时隐藏报告面板', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}/specs/${NO_REVIEW_SPEC_ID}/review`)

    const controlsPane = page.locator('[data-testid="review-controls-pane"]')
    await expect(controlsPane).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('[data-testid="review-report-pane"]')).toHaveCount(0)
    await expect(page.getByText('尚无 review 报告')).toHaveCount(0)

    const controlsBox = await controlsPane.boundingBox()
    const mainBox = await page.locator('main').boundingBox()
    expect(controlsBox?.width).toBeGreaterThan((mainBox?.width ?? 0) * 0.95)
  })
})
