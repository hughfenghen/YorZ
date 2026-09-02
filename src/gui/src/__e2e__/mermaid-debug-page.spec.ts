import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { E2E_CWD, SCROLL_SPEC_ID } from './fixtures/setup.js'

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

const DEBUG_DOC = `---
status: debugging
active: 1
updated_at: '2026-09-02 19:30:00'
---

## Debug 1 · e2e mermaid 渲染

### 1.1 链路

\`\`\`mermaid
flowchart TD
    Enter["进入 Debug"] --> Snap["打快照"]
    Snap --> Loop["调试循环"]
\`\`\`
`

/** debug.md is written by the agent, not the seeder — drop it in place here so the
 *  Debug route has a document containing a mermaid fence to paint. */
function seedDebugDoc(specId: string) {
  writeFileSync(join(E2E_CWD, '.yorz', 'specs', specId, 'debug.md'), DEBUG_DOC, 'utf8')
}

// Regression: SpecDebug rendered markdown into `innerHTML` but never called
// `renderMermaidIn`, so ```mermaid fences stayed as raw `.mermaid` placeholder
// divs — the diagram never painted (SpecDetail did call it, hence the mismatch).
test.describe('Debug 页 mermaid 渲染', () => {
  test('debug.md 中的 mermaid 围栏渲染为 SVG（与 spec 详情页一致）', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    seedDebugDoc(SCROLL_SPEC_ID)

    await page.goto(`/${pid}/specs/${SCROLL_SPEC_ID}/debug`)
    const article = page.locator('article.review-md')
    await expect(article).toBeVisible()

    // The placeholder must exist (markdown emitted a diagram, not a code block)…
    await expect(article.locator('.mermaid').first()).toBeAttached({ timeout: 15_000 })
    // …and must have been painted into a real SVG.
    await expect(article.locator('.mermaid svg').first()).toBeVisible({ timeout: 15_000 })
  })

  test('debug 页 mermaid 支持最大化查看', async ({ page, request }) => {
    const pid = await resolveProjectId(request)
    seedDebugDoc(SCROLL_SPEC_ID)

    await page.goto(`/${pid}/specs/${SCROLL_SPEC_ID}/debug`)
    const article = page.locator('article.review-md')
    await expect(article.locator('.mermaid svg').first()).toBeVisible({ timeout: 15_000 })

    await article.locator('.mermaid').first().hover()
    await page.locator('.mermaid-fullscreen-button').first().click()

    const overlay = page.locator('.mermaid-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay.locator('svg')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()
  })
})
