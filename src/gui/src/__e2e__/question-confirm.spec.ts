import { test, expect } from '@playwright/test'
import { QUESTIONS_SPEC_ID } from './fixtures/setup.js'

test.describe.serial('question confirm panel', () => {
  test('plan 阶段提交结构化答复并触发运行 Agent', async ({ page }) => {
    await page.goto(`/specs/${QUESTIONS_SPEC_ID}`)

    const panel = page.locator('[data-testid="question-confirm-panel"]')
    await expect(panel).toBeVisible({ timeout: 5_000 })
    await expect(panel.locator('.qcp-question')).toHaveText(/候选答案的展现形式应采用哪种？/)

    const recommended = panel.locator('input[type="radio"]')
    const checked = await recommended.evaluateAll((els) =>
      (els as HTMLInputElement[]).map((e) => e.checked),
    )
    expect(checked.some((c) => c)).toBe(true)

    const submitPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/specs/${QUESTIONS_SPEC_ID}/questions/answers`) &&
        res.request().method() === 'POST',
    )

    await panel.locator('button', { hasText: '发送' }).click()
    const submitRes = await submitPromise
    expect(submitRes.status()).toBe(200)

    const detail = await page.request.get(`/api/specs/${QUESTIONS_SPEC_ID}`)
    expect(detail.status()).toBe(200)
    const data = (await detail.json()) as { body: string; frontmatter: { stage: string } }
    expect(data.body).toContain('## 用户批注')
    expect(data.body).toContain('> 待确认问题："候选答案的展现形式应采用哪种？"')
    expect(data.body).toContain('选择：表格')
    expect(data.frontmatter.stage).toBe('plan')
  })

  test('选中"其他（自由批注）"后只提交自定义批注，不携带选项 label', async ({ page }) => {
    await page.goto(`/specs/${QUESTIONS_SPEC_ID}`)

    const panel = page.locator('[data-testid="question-confirm-panel"]')
    await expect(panel).toBeVisible({ timeout: 5_000 })

    // textarea 初始应隐藏（默认选中"表格 (推荐)"）。
    await expect(panel.locator('textarea.qcp-note')).toHaveCount(0)

    // 勾选"其他（自由批注）"radio。
    const freeformLabel = panel.locator('label.qcp-option-freeform')
    await freeformLabel.locator('input[type="radio"]').check()

    // textarea 出现并填入自定义批注。
    const note = panel.locator('textarea.qcp-note')
    await expect(note).toBeVisible()
    await note.fill('我希望换一种方案：用 split pane')

    const submitPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/specs/${QUESTIONS_SPEC_ID}/questions/answers`) &&
        res.request().method() === 'POST',
    )
    await panel.locator('button', { hasText: '发送' }).click()
    const submitRes = await submitPromise
    expect(submitRes.status()).toBe(200)

    const detail = await page.request.get(`/api/specs/${QUESTIONS_SPEC_ID}`)
    expect(detail.status()).toBe(200)
    const data = (await detail.json()) as { body: string }
    // 互斥语义：sentinel + 批注 → block 形如 `！！！备注：…`，不含 `选择：…；`。
    expect(data.body).toContain('！！！备注：我希望换一种方案：用 split pane')
    expect(data.body).not.toContain('选择：其他（自由批注）')
  })
})
