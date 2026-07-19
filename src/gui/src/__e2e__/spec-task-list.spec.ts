import { test, expect } from '@playwright/test'
import { TASK_LIST_SPEC_ID } from './fixtures/setup.js'

async function resolveProjectId(request: import('@playwright/test').APIRequestContext): Promise<string> {
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
})
