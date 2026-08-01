import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { E2E_CWD, SCROLL_SPEC_ID, buildScrollSpec } from './fixtures/setup.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Pick the seeded .tmp-e2e project explicitly: on a machine with several
// registered projects `arr[0]` is not necessarily the e2e temp project.
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

/** Rewrite spec.md repeatedly, slower than SSE_DEBOUNCE_MS so each write drives a
 * real FS-watch → SSE → refresh cycle. buildScrollSpec's mermaid bodies do NOT
 * depend on the marker, so the diagram source is identical across every write. */
async function driveWrites(specId: string, rounds: number) {
  const file = join(E2E_CWD, '.yorz', 'specs', specId, 'spec.md')
  for (let i = 0; i < rounds; i += 1) {
    writeFileSync(file, buildScrollSpec(`w${i}`), 'utf8')
    await sleep(260)
  }
}

// Regression for 260719 (morphdom incremental diff): a mermaid diagram whose
// source is unchanged across an SSE refresh must be preserved in place — the
// rendered SVG node must NOT be re-created. Full replaceChildren used to redraw
// every diagram; morphdom's onBeforeElUpdated skips unchanged mermaid nodes.
test.describe('SSE 刷新后未变 mermaid 原地保留', () => {
  test('源码未变的 mermaid：刷新后 SVG 节点原地保留（未重绘）', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}/specs/${SCROLL_SPEC_ID}`)
    const article = page.locator('article.spec-main')
    await expect(article).toBeVisible()
    await expect(article.locator('svg').first()).toBeVisible({ timeout: 15_000 })

    // Tag the first rendered SVG. If morphdom preserves the node, the tag survives
    // every refresh; if the node were re-created, the tag would be gone.
    const tagged = await page.evaluate(() => {
      const svg = document.querySelector('article.spec-main .mermaid svg')
      if (!svg) return false
      svg.setAttribute('data-e2e-preserve', 'kept')
      return true
    })
    expect(tagged).toBe(true)

    await driveWrites(SCROLL_SPEC_ID, 6)
    await sleep(1200)

    // The very same SVG node (identified by our tag) must still be in the DOM.
    const stillTagged = await page.evaluate(() => {
      const svg = document.querySelector('article.spec-main .mermaid svg[data-e2e-preserve="kept"]')
      return !!svg
    })
    expect(stillTagged).toBe(true)

    // And the diagram is still actually rendered (SVG present, not raw placeholder).
    await expect(article.locator('svg').first()).toBeVisible()
  })

  test('mermaid 图支持最大化、缩放、拖拽平移与 Esc 关闭', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    await page.goto(`/${pid}/specs/${SCROLL_SPEC_ID}`)
    const article = page.locator('article.spec-main')
    await expect(article).toBeVisible()
    await expect(article.locator('.mermaid svg').first()).toBeVisible({ timeout: 15_000 })

    const mermaid = article.locator('.mermaid').first()
    await mermaid.hover()
    await page.locator('.mermaid-fullscreen-button').first().click()

    const overlay = page.locator('.mermaid-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay.locator('svg')).toBeVisible()

    const canvas = overlay.locator('.mermaid-overlay__canvas')
    const beforeZoom = await canvas.evaluate((el) => (el as HTMLElement).style.transform)
    await overlay.locator('.mermaid-overlay__button').nth(1).click()
    await expect
      .poll(() => canvas.evaluate((el) => (el as HTMLElement).style.transform))
      .not.toBe(beforeZoom)

    const beforeDrag = await canvas.evaluate((el) => (el as HTMLElement).style.transform)
    const box = await overlay.locator('.mermaid-overlay__viewport').boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 40)
    await page.mouse.up()
    await expect
      .poll(() => canvas.evaluate((el) => (el as HTMLElement).style.transform))
      .not.toBe(beforeDrag)

    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()
  })
})
