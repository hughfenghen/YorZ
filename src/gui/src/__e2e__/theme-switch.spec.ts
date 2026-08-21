import { test, expect } from '@playwright/test'
import { SCROLL_SPEC_ID } from './fixtures/setup.js'

// 显式挑 .tmp-e2e：本机注册了多个项目时 arr[0] 未必是 e2e 临时项目
async function resolveProjectId(
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
  const res = await request.get('/api/projects')
  const list = (await res.json()) as
    | { projects: Array<{ id: string; name?: string }> }
    | Array<{ id: string; name?: string }>
  const arr = Array.isArray(list) ? list : list.projects
  return (arr.find((p) => p.name === '.tmp-e2e') ?? arr[0]!).id
}

async function openThemeMenu(page: import('@playwright/test').Page): Promise<void> {
  // 限定在顶栏：侧栏的「项目配置」按钮 aria-label 也含「配置」
  await page.locator('header').getByTitle('配置', { exact: true }).click()
  // 语言/外观已收进二级菜单，需先展开「外观」
  await page.locator('[data-submenu="theme"]').hover()
  await expect(page.locator('[data-theme-option="dark"]')).toBeVisible()
}

async function focusSessionToggleWithTab(page: import('@playwright/test').Page): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab')
    const isTarget = await page.evaluate(() => {
      const el = document.activeElement
      return (
        el instanceof HTMLButtonElement &&
        (el.getAttribute('title') === '折叠会话列表' || el.getAttribute('title') === '展开会话列表')
      )
    })
    if (isTarget) return
  }
  throw new Error('未能通过 Tab 聚焦会话折叠按钮')
}

/**
 * 在 document-start 记录 `<html>` 主题属性的首个值，用于证明首屏引导脚本已按目标主题落好属性。
 * 只断言刷新后的最终值是抓不到闪烁的——那是 API 响应回来之后的状态。
 */
async function captureFirstPaintTheme(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __firstPaintTheme?: { name: string | null; theme: string | null }
    }
    const record = () => {
      if (w.__firstPaintTheme || !document.documentElement) return false
      w.__firstPaintTheme = {
        name: document.documentElement.getAttribute('data-kb-theme-name'),
        theme: document.documentElement.getAttribute('data-kb-theme'),
      }
      return true
    }
    // documentElement 在 document-start 时刻可能尚未创建，轮询到它出现为止
    if (!record()) {
      const timer = setInterval(() => {
        if (record()) clearInterval(timer)
      }, 0)
    }
  })
}

async function firstPaintTheme(
  page: import('@playwright/test').Page,
): Promise<{ name: string | null; theme: string | null }> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __firstPaintTheme?: { name: string | null; theme: string | null }
    }
    if (!w.__firstPaintTheme) throw new Error('未捕获到首屏主题属性')
    return w.__firstPaintTheme
  })
}

async function activeOutlineAndRing(page: import('@playwright/test').Page): Promise<{
  outlineColor: string
  ringColor: string
}> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) throw new Error('当前没有可计算样式的焦点元素')
    const probe = document.createElement('div')
    probe.style.color = `hsl(${getComputedStyle(document.documentElement)
      .getPropertyValue('--ring')
      .trim()})`
    document.body.append(probe)
    const ringColor = getComputedStyle(probe).color
    probe.remove()
    return {
      outlineColor: getComputedStyle(active).outlineColor,
      ringColor,
    }
  })
}

test.describe.serial('主题切换', () => {
  test('切到暗色后 data-kb-theme、背景色与 color-scheme 同步变化', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)

    // 先显式落到亮色，避免受运行环境系统偏好影响
    await openThemeMenu(page)
    await page.locator('[data-theme-option="light"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme', 'light')

    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

    await openThemeMenu(page)
    await page.locator('[data-theme-option="dark"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme', 'dark')

    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(darkBg).not.toBe(lightBg)

    // 原生控件（滚动条/表单）需跟随主题
    const colorScheme = await page.evaluate(() => document.documentElement.style.colorScheme)
    expect(colorScheme).toBe('dark')
  })

  test('选择持久化：刷新后仍是暗色，且首屏不闪烁（引导脚本先于渲染生效）', async ({
    page,
    request,
  }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)

    await openThemeMenu(page)
    await page.locator('[data-theme-option="dark"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme', 'dark')

    const cfg = await request.get('/api/global-config')
    expect((await cfg.json()).appearance.themeMode).toBe('dark')

    await captureFirstPaintTheme(page)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme', 'dark')

    // 首屏就必须是 dark，而不是等 /api/global-config 回来才翻转
    expect((await firstPaintTheme(page)).theme).toBe('dark')
  })

  test('主题族切换持久化，刷新前首屏引导属性已生效', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)

    await openThemeMenu(page)
    await page.locator('[data-theme-name-option="terminal"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme-name', 'terminal')
    const terminalBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

    await openThemeMenu(page)
    await page.locator('[data-theme-name-option="graphite"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme-name', 'graphite')
    const cfg = await request.get('/api/global-config')
    expect((await cfg.json()).appearance.themeName).toBe('graphite')

    const graphiteBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(graphiteBg).not.toBe(terminalBg)

    await captureFirstPaintTheme(page)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme-name', 'graphite')

    // 首屏就必须是 graphite：若引导脚本读不到外观提示，这里会是 terminal（刷新闪烁）
    expect((await firstPaintTheme(page)).name).toBe('graphite')
  })

  test('非法主题族旧存储值不会覆盖全局配置', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)
    await openThemeMenu(page)
    await page.locator('[data-theme-name-option="terminal"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme-name', 'terminal')
    await page.evaluate(() => localStorage.setItem('yorz.themeName', 'unknown-theme'))

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme-name', 'terminal')
  })

  test('Tab 聚焦手写按钮时 outline 使用当前主题 ring 色', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)

    await openThemeMenu(page)
    await page.locator('[data-theme-name-option="graphite"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme-name', 'graphite')

    await focusSessionToggleWithTab(page)
    const graphite = await activeOutlineAndRing(page)
    expect(graphite.outlineColor).toBe(graphite.ringColor)
    expect(graphite.outlineColor).not.toBe('rgb(0, 95, 204)')

    await openThemeMenu(page)
    await page.locator('[data-theme-name-option="paper"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme-name', 'paper')

    await focusSessionToggleWithTab(page)
    const paper = await activeOutlineAndRing(page)
    expect(paper.outlineColor).toBe(paper.ringColor)
    expect(paper.outlineColor).not.toBe(graphite.outlineColor)
  })

  test('主题翻转后 mermaid 图表重新渲染', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    // 复用已 seed 的 mermaid 密集 spec，避免在测试内造数据
    await page.goto(`/${pid}/specs/${SCROLL_SPEC_ID}`)
    const svg = page.locator('.mermaid svg').first()
    await expect(svg).toBeVisible({ timeout: 15_000 })

    await openThemeMenu(page)
    await page.locator('[data-theme-option="light"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme', 'light')
    await expect(svg).toBeVisible({ timeout: 15_000 })

    // 给第一张图打标记：主题翻转必须重绘，标记随旧节点一起消失
    await page.evaluate(() => {
      document.querySelector('.mermaid svg')?.setAttribute('data-e2e-theme', 'before')
    })

    await openThemeMenu(page)
    await page.locator('[data-theme-option="dark"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-kb-theme', 'dark')

    await expect
      .poll(
        async () =>
          page.evaluate(
            () => document.querySelector('.mermaid svg')?.getAttribute('data-e2e-theme') ?? null,
          ),
        { timeout: 15_000 },
      )
      .toBeNull()
    await expect(page.locator('.mermaid svg').first()).toBeVisible({ timeout: 15_000 })
  })
})
