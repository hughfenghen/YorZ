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
  return (arr.find((p) => p.name === '.tmp-e2e') ?? arr[0]!).id
}

async function dispatchShortcut(page: import('@playwright/test').Page, key: string) {
  await page.evaluate((k) => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: k,
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, key)
}

test('默认快捷键触发高频操作', async ({ page, request }) => {
  const pid = await resolveProjectId(request)

  await page.goto(`/${pid}`)
  await expect(page.getByRole('link', { name: /新建 spec|New Spec/i })).toBeVisible()
  const listFocusButton = page.getByRole('button', { name: /全屏|Fullscreen/ })
  await expect(listFocusButton).toBeVisible()
  await dispatchShortcut(page, 'F')
  await expect(listFocusButton).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(listFocusButton).toHaveAttribute('aria-pressed', 'false')

  await dispatchShortcut(page, 'N')
  await expect(page).toHaveURL(new RegExp(`/${pid}/specs/new$`))

  await page.goto(`/${pid}`)
  await page.getByRole('link', { name: new RegExp(SPEC_ID) }).click()
  const focusButton = page.getByRole('button', { name: /全屏|Fullscreen/ })
  await expect(focusButton).toBeVisible()
  await dispatchShortcut(page, 'F')
  await expect(focusButton).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(focusButton).toHaveAttribute('aria-pressed', 'false')

  await page.getByPlaceholder(/输入消息|Type a message/).dispatchEvent('keydown', {
    key: 'F',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })
  await expect(focusButton).toHaveAttribute('aria-pressed', 'true')

  await dispatchShortcut(page, 'S')
  await expect(
    page.getByRole('dialog').filter({ hasText: /项目配置|Project Config/ }),
  ).toBeVisible()
})
