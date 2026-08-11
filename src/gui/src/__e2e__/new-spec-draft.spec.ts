import { expect, test } from '@playwright/test'

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

function storageKey(pid: string): string {
  return `yorz:new-spec-draft:${pid}`
}

test('新建 spec 页面会按项目记忆并恢复草稿输入', async ({ page, request }) => {
  const pid = await resolveProjectId(request)
  await page.goto(`/${pid}/specs/new`)
  await page.evaluate((key) => localStorage.removeItem(key), storageKey(pid))

  await page.getByText('fix', { exact: true }).click()
  await page.getByText('新开项目并行').click()
  await page.getByLabel('需求内容').fill('记住新建 spec 页面输入内容')

  await page.goto(`/${pid}`)
  await page.goto(`/${pid}/specs/new`)

  await expect(page.getByLabel('需求内容')).toHaveValue('记住新建 spec 页面输入内容')
  await expect(page.getByLabel('fix')).toBeChecked()
  await expect(page.getByLabel('新开项目并行')).toBeChecked()

  await page.reload()

  await expect(page.getByLabel('需求内容')).toHaveValue('记住新建 spec 页面输入内容')
  await expect(page.getByLabel('fix')).toBeChecked()
  await expect(page.getByLabel('新开项目并行')).toBeChecked()
})

test('新建 spec 点击发送进入创建流程后清理草稿', async ({ page, request }) => {
  const pid = await resolveProjectId(request)
  const key = storageKey(pid)

  await page.route(`**/api/projects/${encodeURIComponent(pid)}/specs`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: '260811.feat.mock-created', path: 'spec.md' }),
    })
  })

  await page.goto(`/${pid}/specs/new`)
  await page.evaluate((draftKey) => localStorage.removeItem(draftKey), key)
  await page.getByLabel('需求内容').fill('发送后清理新建 spec 草稿')

  await expect
    .poll(() => page.evaluate((draftKey) => localStorage.getItem(draftKey), key))
    .not.toBeNull()

  await page.locator('form button[type="submit"]').click()

  await expect(page).toHaveURL(new RegExp(`/${pid}/specs/260811\\.feat\\.mock-created$`))
  await expect(page.evaluate((draftKey) => localStorage.getItem(draftKey), key)).resolves.toBeNull()
})
