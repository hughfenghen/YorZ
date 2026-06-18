import { test, expect } from '@playwright/test'
import { QUESTIONS_SPEC_ID } from './fixtures/setup.js'

test.describe('question confirm panel', () => {
  test('plan 阶段提交结构化答复并触发运行 Agent', async ({ page }) => {
    await page.goto(`/specs/${QUESTIONS_SPEC_ID}`)

    const panel = page.locator('.question-confirm-panel')
    await expect(panel).toBeVisible({ timeout: 5_000 })
    await expect(panel.locator('.qcp-question')).toHaveText(/候选答案的展现形式应采用哪种？/)

    // The recommended option should be selected by default.
    const recommended = panel.locator('input[type="radio"]', {
      has: undefined,
    })
    const checked = await recommended.evaluateAll((els) =>
      (els as HTMLInputElement[]).map((e) => e.checked),
    )
    expect(checked.some((c) => c)).toBe(true)

    // Wait for both the API call and the subsequent runAgent call (which will
    // attempt to spawn the real agent and may fail; we only care that GUI
    // posts the answers payload).
    const submitPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/specs/${QUESTIONS_SPEC_ID}/questions/answers`) &&
        res.request().method() === 'POST',
    )

    await panel.locator('button', { hasText: '提交全部' }).click()
    const submitRes = await submitPromise
    expect(submitRes.status()).toBe(200)

    // Verify the spec md got the user annotations section via API.
    const detail = await page.request.get(`/api/specs/${QUESTIONS_SPEC_ID}`)
    expect(detail.status()).toBe(200)
    const data = (await detail.json()) as { body: string; frontmatter: { stage: string } }
    expect(data.body).toContain('## 用户批注')
    expect(data.body).toContain('> 待确认问题："候选答案的展现形式应采用哪种？"')
    expect(data.body).toContain('选择：表格')
    expect(data.frontmatter.stage).toBe('plan')
  })
})
