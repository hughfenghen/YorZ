import { test, expect } from '@playwright/test'
import { SPEC_ID } from './fixtures/setup.js'

async function resolveProjectId(
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const res = await request.get('/api/projects')
  expect(res.status()).toBe(200)
  const list = (await res.json()) as { projects: Array<{ id: string }> } | Array<{ id: string }>
  const arr = Array.isArray(list) ? list : list.projects
  expect(arr.length).toBeGreaterThan(0)
  return arr[0]!.id
}

test.describe('selection menu', () => {
  test('选中正文应弹出浮动菜单（含批注与解释按钮）', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}/specs/${SPEC_ID}`)

    const article = page.locator('article.markdown')
    await expect(article).toBeVisible()
    await expect(article.locator('p').first()).toContainText('Playwright')

    await page.evaluate(() => {
      const article = document.querySelector('article.markdown')
      if (!article) throw new Error('article not found')
      const paragraphs = article.querySelectorAll('p')
      let target: Text | null = null
      for (const p of Array.from(paragraphs)) {
        const txt = p.firstChild
        if (txt && txt.nodeType === 3 && (txt.textContent ?? '').length >= 10) {
          target = txt as Text
          break
        }
      }
      if (!target) throw new Error('no suitable text node')
      const range = document.createRange()
      range.setStart(target, 0)
      range.setEnd(target, Math.min(8, (target.textContent ?? '').length))
      const sel = window.getSelection()
      if (!sel) throw new Error('no selection api')
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    const menu = page.locator('.selection-menu')
    await expect(menu).toBeVisible({ timeout: 5_000 })
    await expect(menu.locator('button', { hasText: '批注' })).toBeVisible()
    await expect(menu.locator('button', { hasText: '解释' })).toBeVisible()
  })
})
