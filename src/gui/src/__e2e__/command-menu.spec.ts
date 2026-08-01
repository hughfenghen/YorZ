import { test, expect } from '@playwright/test'

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

test.describe.serial('command menu', () => {
  test('顶栏只有一个命令入口，且紧邻标题左对齐', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)

    const title = page.locator('h1', { hasText: 'Spec 列表' })
    await expect(title).toBeVisible({ timeout: 10_000 })

    const trigger = page.getByTitle('命令', { exact: true })
    await expect(trigger).toBeVisible()

    // 追加任务 2：不再有独立的「添加命令」icon 入口
    await expect(page.getByTitle('添加命令')).toHaveCount(0)

    // 追加任务 4：入口紧邻 h1 右侧（靠左），而非贴在 header 最右
    const [titleBox, triggerBox] = await Promise.all([title.boundingBox(), trigger.boundingBox()])
    expect(titleBox && triggerBox).toBeTruthy()
    if (!titleBox || !triggerBox) return
    expect(triggerBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width - 4)
    expect(triggerBox.x - (titleBox.x + titleBox.width)).toBeLessThan(40)

    const focusBtn = page.locator('header button').last()
    const focusBox = await focusBtn.boundingBox()
    // 命令入口应明显位于右侧焦点按钮的左边
    if (focusBox) expect(triggerBox.x).toBeLessThan(focusBox.x - 50)
  })

  test('dropdown 左对齐展开，「添加命令」打开的 modal 不会被 dropdown 关闭连带隐藏', async ({
    page,
    request,
  }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)

    const trigger = page.getByTitle('命令', { exact: true })
    await expect(trigger).toBeVisible({ timeout: 10_000 })
    await trigger.click()

    const addItem = page.getByText('添加命令', { exact: true })
    await expect(addItem).toBeVisible()

    // 追加任务 4：菜单与触发器左缘对齐（start 对齐），而非右缘对齐（end 对齐）。
    // Kobalte 会带几像素的定位偏移，故用区间而非严格相等。
    const [triggerBox, menuBox] = await Promise.all([
      trigger.boundingBox(),
      page.locator('[role="menu"]').boundingBox(),
    ])
    if (triggerBox && menuBox) {
      expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThanOrEqual(12)
      expect(menuBox.x).toBeGreaterThanOrEqual(0)
      // end 对齐时菜单会整体左移到 trigger.right - menu.width，明显更靠左
      const endAlignedX = triggerBox.x + triggerBox.width - menuBox.width
      expect(menuBox.x).toBeGreaterThan(endAlignedX + 20)
    }

    await addItem.click()

    // 追加任务 3：这是回归重点 —— 点击菜单项会关闭 dropdown，
    // 旧的 Popover 实现会随 anchor 卸载而立即消失；Dialog 必须保持可见。
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(500)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('名称')).toBeVisible()
    await expect(dialog.getByText('命令行')).toBeVisible()
  })

  test('新增命令后可执行，运行中容器与 spec 卡片列宽一致', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)

    const trigger = page.getByTitle('命令', { exact: true })
    await expect(trigger).toBeVisible({ timeout: 10_000 })
    await trigger.click()
    await page.getByText('添加命令', { exact: true }).click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    await dialog.locator('#command-name').fill('e2e-ticker')
    await dialog
      .locator('#command-cli')
      .fill(`node -e "setInterval(function(){console.log('tick')},300)"`)
    await dialog.getByRole('button', { name: '添加' }).click()
    await expect(dialog).toBeHidden()

    // 执行该命令 → 跳转详情页 → 返回列表
    await trigger.click()
    await page.getByText('e2e-ticker', { exact: true }).click()
    await expect(page.locator('h1', { hasText: '命令执行详情' })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('pre')).toContainText('tick', { timeout: 10_000 })

    await page.getByRole('link', { name: '返回列表' }).click()
    await expect(page.locator('h1', { hasText: 'Spec 列表' })).toBeVisible()

    // 追加任务 1：运行中条目与 spec 卡片同宽（同一套弹性网格）。
    // 两个矩形必须在同一帧内量取：返回列表会触发 resource refetch，行元素随之
    // 重建，分两次 boundingBox() 会拿到已脱离文档的旧节点（返回 null）。
    const runItem = page.locator('section ul li').filter({ hasText: 'e2e-ticker' }).first()
    await expect(runItem).toBeVisible({ timeout: 10_000 })

    const dims = await page
      .waitForFunction(
        () => {
          const lis = Array.from(document.querySelectorAll('ul li'))
          const run = lis.find((li) => li.textContent?.includes('e2e-ticker'))
          const card = lis.find((li) => li.querySelector('a[href*="/specs/"]'))
          if (!run || !card) return null
          const r = run.getBoundingClientRect()
          const c = card.getBoundingClientRect()
          if (r.width === 0 || c.width === 0) return null
          return { runWidth: r.width, runX: r.x, cardWidth: c.width, cardX: c.x }
        },
        null,
        { timeout: 10_000 },
      )
      .then((h) => h.jsonValue())

    expect(dims).not.toBeNull()
    if (!dims) return
    expect(Math.abs(dims.runWidth - dims.cardWidth)).toBeLessThanOrEqual(1)
    expect(Math.abs(dims.runX - dims.cardX)).toBeLessThanOrEqual(1)

    // 清理：x → 二次确认清空（触发器 title 与确认按钮同名，需限定在弹层内）
    await runItem.getByTitle('终止并清空').click()
    const confirmPopover = page.locator('[role="dialog"]').filter({ hasText: '终止并清空该条记录' })
    await expect(confirmPopover).toBeVisible()
    await confirmPopover.getByRole('button', { name: '终止并清空' }).click()
    await expect(runItem).toBeHidden({ timeout: 10_000 })
  })
})
