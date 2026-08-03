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

test('toast 可见时顶栏空白覆盖区不应吞掉页面点击', async ({ page, request }) => {
  const pid = await resolveProjectId(request)
  await page.goto(`/${pid}/specs/${SPEC_ID}`)

  const copyButton = page.getByRole('button', { name: '复制 spec 文件路径' })
  await expect(copyButton).toBeVisible({ timeout: 10_000 })
  await copyButton.click()
  await expect(page.getByText(/已复制 spec 文件路径|复制 spec 文件路径失败/)).toBeVisible()

  const newSpec = page.getByRole('link', { name: '新建 Spec' })
  await expect(newSpec).toBeVisible()
  const box = await newSpec.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const hit = await page.evaluate(
    ([cx, cy]) => {
      const el = document.elementFromPoint(cx, cy)
      return {
        tag: el?.tagName ?? null,
        text: el?.textContent?.trim().slice(0, 80) ?? null,
        role: el?.getAttribute('role') ?? null,
        classes: el?.getAttribute('class') ?? null,
      }
    },
    [x, y],
  )

  await page.mouse.click(x, y)

  expect(hit.text).toMatch(/新建\s*spec/i)
  await expect(page).toHaveURL(new RegExp(`/${pid}/specs/new$`))
})
