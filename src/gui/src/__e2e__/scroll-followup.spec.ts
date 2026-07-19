// Regression for 260715 (Debug 2): a scroll the user makes BETWEEN refreshes must
// be honored — the reading position must follow the latest scroll, not drift or
// snap back to an earlier one. Root cause was mermaid's raw→SVG re-render tripping
// the browser's scroll anchoring; fixed by double-buffering the render offscreen.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { E2E_CWD, SCROLL_SPEC_ID, buildScrollSpec } from './fixtures/setup.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function resolveProjectId(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const res = await request.get('/api/projects')
  const list = (await res.json()) as { projects: Array<{ id: string }> } | Array<{ id: string }>
  const arr = Array.isArray(list) ? list : list.projects
  return arr[0]!.id
}

test('刷新之间移动滚动位置应被跟随，不漂移/不回退', async ({ page, request }) => {
  const pid = await resolveProjectId(request)
  await page.goto(`/${pid}/specs/${SCROLL_SPEC_ID}`)
  const article = page.locator('article.spec-main')
  await expect(article).toBeVisible()
  await expect(article.locator('svg').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForFunction(() => {
    const el = document.querySelector('article.spec-main') as HTMLElement | null
    return !!el && el.scrollHeight - el.clientHeight > 6000
  })

  const file = join(E2E_CWD, '.yorz', 'specs', SCROLL_SPEC_ID, 'spec.md')

  // 位置 A（前中部）→ 刷新一次 → 应保持在 A
  await article.evaluate((el) => {
    el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) * 0.35)
  })
  writeFileSync(file, buildScrollSpec('a'), 'utf8')
  await sleep(1600)

  // 用户移动到更靠后的位置 B → 刷新一次 → 应停在 B（而非漂移或回退到 A）
  const setB = await article.evaluate((el) => {
    el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) * 0.7)
    return el.scrollTop
  })
  writeFileSync(file, buildScrollSpec('b'), 'utf8')
  await sleep(1600)

  const finalTop = await article.evaluate((el) => el.scrollTop)
  expect(Math.abs(finalTop - setB)).toBeLessThan(setB * 0.15)
})
