import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const E2E_CWD = resolve(__dirname, '..', '..', '..', '..', '.tmp-e2e')
const SPECS_DIR = join(E2E_CWD, '.yorz', 'specs')

// 95 = 2 整页 + 15，能同时覆盖「多次追加」和「最后一页不足 40 条」两种边界。
const EXTRA_COUNT = 95
const PREFIX = '260801.feat.e2e-page-'

function extraSpecIds(): string[] {
  return Array.from({ length: EXTRA_COUNT }, (_, i) => `${PREFIX}${String(i).padStart(3, '0')}`)
}

function seedExtraSpecs() {
  for (const [i, id] of extraSpecIds().entries()) {
    const dir = join(SPECS_DIR, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'spec.md'),
      `---
stage: plan
last_action: e2e 分页种子
updated_at: '2026-08-01 12:00:00'
summary: 分页用例填充 spec ${i}
---

# 分页填充 ${i}
`,
      'utf8',
    )
  }
}

function cleanupExtraSpecs() {
  for (const id of extraSpecIds()) {
    rmSync(join(SPECS_DIR, id), { recursive: true, force: true })
  }
}

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

test.describe.serial('SpecList 滚动分页', () => {
  test.beforeAll(() => seedExtraSpecs())
  test.afterAll(() => cleanupExtraSpecs())

  test('首屏 40 条，滚动到底逐批追加直到全量', async ({ page, request }) => {
    const pid = await resolveProjectId(request)

    const total = await (async () => {
      const res = await request.get(`/api/projects/${pid}/specs`)
      expect(res.status()).toBe(200)
      const body = (await res.json()) as unknown
      const arr = Array.isArray(body) ? body : (body as { specs: unknown[] }).specs
      return arr.length
    })()
    expect(total).toBeGreaterThan(80)

    await page.goto(`/${pid}`)

    // 限定在 spec 网格内：侧边栏项目列表也用 li.group，会多算一条。
    const cards = page.locator('main ul.grid > li.group')
    // 首屏严格停在 40 条，证明没有一次性渲染全量。
    await expect(cards).toHaveCount(40, { timeout: 10_000 })

    // 滚动容器是本页 section（main 被 min-h-0 约束住，自身不滚动）。
    const scroller = page.locator('main section.overflow-y-auto').first()
    // 反复滚到底，每轮应再放开一批，直到追平总数。
    for (let round = 0; round < 6; round++) {
      const before = await cards.count()
      if (before >= total) break
      await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await expect(cards).not.toHaveCount(before, { timeout: 5_000 })
    }

    await expect(cards).toHaveCount(total, { timeout: 10_000 })
    // 全部加载完后底部哨兵（加载提示）应消失。
    await expect(page.getByText('加载中', { exact: false })).toHaveCount(0)
  })
})
