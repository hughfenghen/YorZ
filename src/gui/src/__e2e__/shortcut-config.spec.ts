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
  const configDialog = page.getByRole('dialog').filter({ hasText: /项目配置|Project Config/ })
  await expect(configDialog).toBeVisible()

  // 再按一次关闭（toggle）。这里用真实键盘事件而非 dispatchEvent：对话框会把焦点
  // 放进自己的输入框，关闭这条路径必须不被「可编辑元素吞掉快捷键」的规则拦下。
  await page.keyboard.press('Control+Shift+S')
  await expect(configDialog).toBeHidden()
})

test('review 页的全屏快捷键与列表/详情页一致', async ({ page, request }) => {
  const pid = await resolveProjectId(request)

  await page.goto(`/${pid}/specs/${SPEC_ID}/review`)
  const focusButton = page.getByRole('button', { name: /全屏|Fullscreen/ })
  await expect(focusButton).toBeVisible()
  await expect(focusButton).toHaveAttribute('aria-pressed', 'false')

  await dispatchShortcut(page, 'F')
  await expect(focusButton).toHaveAttribute('aria-pressed', 'true')
  await dispatchShortcut(page, 'F')
  await expect(focusButton).toHaveAttribute('aria-pressed', 'false')
})
