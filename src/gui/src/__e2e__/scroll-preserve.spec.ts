import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  E2E_CWD,
  SCROLL_SPEC_ID,
  SCROLL_TEXT_SPEC_ID,
  buildScrollSpec,
  buildScrollTextSpec,
} from './fixtures/setup.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function resolveProjectId(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const res = await request.get('/api/projects')
  const list = (await res.json()) as
    | { projects: Array<{ id: string; name?: string }> }
    | Array<{ id: string; name?: string }>
  const arr = Array.isArray(list) ? list : list.projects
  // Select the seeded .tmp-e2e project explicitly: with several registered
  // projects `arr[0]` is not necessarily the e2e temp project.
  return (arr.find((p) => p.name === '.tmp-e2e') ?? arr[0]!).id
}

/**
 * Simulate an agent持续更新 spec.md: rewrite the file on disk repeatedly, slower
 * than SSE_DEBOUNCE_MS(120) so each write drives a real FS-watch → SSE → refresh
 * cycle through the same path the app uses in production.
 */
async function driveWrites(specId: string, build: (m: string) => string, rounds: number) {
  const file = join(E2E_CWD, '.yorz', 'specs', specId, 'spec.md')
  for (let i = 0; i < rounds; i += 1) {
    writeFileSync(file, build(`w${i}`), 'utf8')
    await sleep(260)
  }
}

// Regression for 260715: SSE-driven refreshes must NOT reset the article scroll
// to the top. Root cause was <Suspense> re-suspending on refetch and detaching
// the scroll container; fixed by refreshing inside a transition.
test.describe('SSE 刷新后正文滚动位置保持', () => {
  test('mermaid 密集：持续更新后滚动位置不被重置到顶部', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}/specs/${SCROLL_SPEC_ID}`)
    const article = page.locator('article.spec-main')
    await expect(article).toBeVisible()
    await expect(article.locator('svg').first()).toBeVisible({ timeout: 15_000 })
    // 等 mermaid 渲染出 SVG、正文达到多屏高度
    await page.waitForFunction(() => {
      const el = document.querySelector('article.spec-main') as HTMLElement | null
      return !!el && el.scrollHeight - el.clientHeight > 6000
    })

    const target = await article.evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) * 0.7)
      return el.scrollTop
    })
    expect(target).toBeGreaterThan(200)

    await driveWrites(SCROLL_SPEC_ID, buildScrollSpec, 8)
    await sleep(1500)

    const finalTop = await article.evaluate((el) => el.scrollTop)
    // 修复前 finalTop 会被重置为 0；修复后应停在阅读区（允许小幅漂移）
    expect(finalTop).toBeGreaterThan(target * 0.6)
  })

  test('纯文本对照：持续更新后滚动位置保持（隔离 mermaid 变量）', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}/specs/${SCROLL_TEXT_SPEC_ID}`)
    const article = page.locator('article.spec-main')
    await expect(article).toBeVisible()
    await page.waitForFunction(() => {
      const el = document.querySelector('article.spec-main') as HTMLElement | null
      return !!el && el.scrollHeight - el.clientHeight > 2000
    })

    const target = await article.evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) * 0.7)
      return el.scrollTop
    })
    expect(target).toBeGreaterThan(200)

    await driveWrites(SCROLL_TEXT_SPEC_ID, buildScrollTextSpec, 8)
    await sleep(1200)

    const finalTop = await article.evaluate((el) => el.scrollTop)
    expect(finalTop).toBeGreaterThan(target * 0.6)
  })
})
