import { test, expect, type Page } from '@playwright/test'
import { SPEC_ID } from './fixtures/setup.js'

/**
 * 页面切换的 View Transition 专项用例。
 *
 * 全局配置把 e2e 跑在 `reducedMotion: 'reduce'` 下（运行时据此整段跳过过渡），
 * 让其余既有用例保持确定性；这一支单独 opt-in 回真实动画，覆盖两件事：
 *
 * 1. 方向标记 `<html data-vt>` 在过渡期间出现、过渡结束后被清除；
 * 2. **最容易被拦坏的那条路径**——浏览器后退。运行时对导航是「preventDefault
 *    拦下 → 起过渡 → 在更新回调里 retry(true) 重放」，历史步进要多绕一次
 *    history.go，一旦顺序错了表现就是「后退没反应」或「退过头」。
 */

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

/**
 * 用 MutationObserver 记录 data-vt 的每一次取值，而不是点击后去轮询读取——
 * 过渡只有 180ms，轮询会和动画赛跑，观察者则不会漏掉中间态。
 */
async function watchDirections(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __vtSeen?: string[]; __vtObserver?: MutationObserver }
    w.__vtObserver?.disconnect()
    w.__vtSeen = []
    const observer = new MutationObserver(() => {
      const v = document.documentElement.getAttribute('data-vt')
      if (v) w.__vtSeen!.push(v)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-vt'] })
    w.__vtObserver = observer
  })
}

function seenDirections(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __vtSeen?: string[] }).__vtSeen ?? [])
}

function hasDirectionAttr(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.hasAttribute('data-vt'))
}

const SPEC_URL_RE = new RegExp(`/specs/${SPEC_ID.replace(/\./g, '\\.')}$`)

test.describe.serial('页面切换视图过渡', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  test('下钻标记 forward，收尾清除标记', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)
    const card = page.locator(`a[href="/${pid}/specs/${SPEC_ID}"]`).first()
    await expect(card).toBeVisible({ timeout: 5_000 })

    await watchDirections(page)
    await card.click()
    await expect(page).toHaveURL(SPEC_URL_RE)

    await expect.poll(() => seenDirections(page), { timeout: 5_000 }).toContain('forward')
    // 收尾必须摘掉属性，否则下一次过渡会沿用上一次的方向
    await expect.poll(() => hasDirectionAttr(page), { timeout: 5_000 }).toBe(false)
  })

  test('浏览器后退仍然生效，且标记为 back', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)
    await page.locator(`a[href="/${pid}/specs/${SPEC_ID}"]`).first().click()
    await expect(page).toHaveURL(SPEC_URL_RE)
    await expect.poll(() => hasDirectionAttr(page), { timeout: 5_000 }).toBe(false)

    await watchDirections(page)
    await page.goBack()

    // 重放导航后必须真的回到列表页：退过头 / 没退动都会在这里露馅
    await expect(page).toHaveURL(new RegExp(`/${pid}$`))
    await expect(page.locator(`a[href="/${pid}/specs/${SPEC_ID}"]`).first()).toBeVisible({
      timeout: 5_000,
    })
    await expect.poll(() => seenDirections(page), { timeout: 5_000 }).toContain('back')
    await expect.poll(() => hasDirectionAttr(page), { timeout: 5_000 }).toBe(false)
  })
})

test.describe('减弱动态效果时不起过渡', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })

  test('切页全程不写 data-vt', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}`)
    await watchDirections(page)
    await page.locator(`a[href="/${pid}/specs/${SPEC_ID}"]`).first().click()
    await expect(page).toHaveURL(SPEC_URL_RE)
    expect(await seenDirections(page)).toEqual([])
    expect(await hasDirectionAttr(page)).toBe(false)
  })
})
