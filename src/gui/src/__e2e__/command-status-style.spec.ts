import { test, expect } from '@playwright/test'

async function resolveProjectId(
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const res = await request.get('/api/projects')
  const list = (await res.json()) as { projects: Array<{ id: string }> } | Array<{ id: string }>
  const arr = Array.isArray(list) ? list : list.projects
  return arr[0]!.id
}

async function seedRun(
  request: import('@playwright/test').APIRequestContext,
  pid: string,
  name: string,
): Promise<string> {
  const def = (await (
    await request.post(`/api/projects/${pid}/commands`, {
      data: { name, cli: `node -e "setInterval(function(){console.log('tick')},300)"` },
    })
  ).json()) as { id: string }
  const run = (await (
    await request.post(`/api/projects/${pid}/command-runs`, { data: { commandId: def.id } })
  ).json()) as { runId: string }
  return run.runId
}

test.describe.serial('command status is plain text, not a button-like chip', () => {
  test('列表与详情页的状态均为纯文字，无按钮/徽标外观', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    const runId = await seedRun(request, pid, 'style-list')

    // ---- 列表页 ----
    await page.goto(`/${pid}`)
    const runItem = page.locator('section ul li').filter({ hasText: 'style-list' }).first()
    await expect(runItem).toBeVisible({ timeout: 10_000 })

    const listStatus = runItem.getByText('运行中', { exact: true })
    await expect(listStatus).toBeVisible()
    // 不可交互：不是 button，也不带按钮/徽标的填充背景与圆角
    expect(await listStatus.evaluate((el) => el.tagName)).toBe('SPAN')
    const listStyle = await listStatus.evaluate((el) => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, radius: s.borderRadius, border: s.borderTopWidth }
    })
    expect(listStyle.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    expect(listStyle.radius).toBe('0px')
    expect(listStyle.border).toBe('0px')

    // ---- 详情页 ----
    await page.goto(`/${pid}/commands/${runId}`)
    await expect(page.locator('h1', { hasText: '命令执行详情' })).toBeVisible({ timeout: 10_000 })
    const detailStatus = page.getByText('运行中', { exact: true })
    await expect(detailStatus).toBeVisible()
    expect(await detailStatus.evaluate((el) => el.tagName)).toBe('SPAN')
    const detailStyle = await detailStatus.evaluate((el) => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, radius: s.borderRadius }
    })
    expect(detailStyle.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    expect(detailStyle.radius).toBe('0px')

    await request.delete(`/api/projects/${pid}/command-runs/${runId}`)
  })

  test('详情页信息栏中「终止」按钮位于最左侧', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    const runId = await seedRun(request, pid, 'style-detail')

    await page.goto(`/${pid}/commands/${runId}`)
    const stopBtn = page.getByRole('button', { name: '终止' })
    await expect(stopBtn).toBeVisible({ timeout: 10_000 })

    // 与同一行内其它元素比较左缘：终止按钮必须是最靠左的那个
    const leftmost = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === '终止',
      )
      if (!btn) return null
      const row = btn.parentElement!
      const kids = Array.from(row.children) as HTMLElement[]
      const btnX = btn.getBoundingClientRect().x
      const minX = Math.min(...kids.map((k) => k.getBoundingClientRect().x))
      return { btnX, minX, isFirstChild: row.firstElementChild === btn, count: kids.length }
    })
    expect(leftmost).not.toBeNull()
    if (!leftmost) return
    expect(leftmost.count).toBeGreaterThan(1)
    expect(leftmost.isFirstChild).toBe(true)
    expect(leftmost.btnX).toBeLessThanOrEqual(leftmost.minX + 0.5)

    await request.delete(`/api/projects/${pid}/command-runs/${runId}`)
  })
})
