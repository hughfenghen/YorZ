import { test, expect } from '@playwright/test'
import { SCROLL_SPEC_ID } from './fixtures/setup.js'

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

test.describe('列表页进入详情页 mermaid 渲染', () => {
  test('从 spec 列表客户端导航进入详情页时 mermaid SVG 正常渲染', async ({
    page,
    request,
  }) => {
    const mermaidErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('[mermaid] render error')) {
        mermaidErrors.push(msg.text())
      }
    })

    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)
    await page.getByText(SCROLL_SPEC_ID).click()

    const article = page.locator('article.spec-main')
    await expect(article).toBeVisible()
    await expect(article.locator('svg').first()).toBeVisible({ timeout: 15_000 })
    expect(mermaidErrors).toEqual([])
  })
})
