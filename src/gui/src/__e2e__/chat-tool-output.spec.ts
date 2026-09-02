import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * Regression: a tool output the reader had opened collapsed itself again on the
 * next stream tick.
 *
 * `groupParts` allocates fresh block/segment objects on every recompute, so the
 * message list's reference-keyed reconciliation disposed and remounted the whole
 * tool tree roughly twelve times a second while a session ran. The expand state
 * lived inside `ChatToolBlock` and died with the instance; the scroll box died
 * with the DOM node. Reading a tool result mid-run was effectively impossible.
 *
 * The stream here is real production code end to end — only the SSE transport is
 * stubbed (same layer as `page.route`), so the deltas travel the exact path a
 * live agent's would: `msg` frame → mux → `subscribeSession` → `pushPart`.
 */

const SESSION = 'e2e-tool-output'
const HEAD_MARK = 'HEAD-MARKER'
const TAIL_MARK = 'TAIL-MARKER'
/**
 * Head inside the 300-char preview, tail far beyond it — and tall enough when
 * expanded to overflow the 512px box, which is what makes the scroll assertion
 * meaningful.
 */
const LONG_RESULT = [
  HEAD_MARK,
  ...Array.from({ length: 80 }, (_, i) => `line ${i} ${'y'.repeat(40)}`),
  TAIL_MARK,
].join('\n')

async function resolveProjectId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/projects')
  expect(res.status()).toBe(200)
  const list = (await res.json()) as Array<{ id: string }> | { projects: Array<{ id: string }> }
  const arr = Array.isArray(list) ? list : list.projects
  expect(arr.length).toBeGreaterThan(0)
  return arr[0]!.id
}

/**
 * Replace `EventSource` with a driveable stub. The app opens exactly one for the
 * whole tab (`SseMultiplex`), and everything is dispatched as `msg` frames keyed
 * by topic — so a single `__sseEmit` can play any server event the test needs.
 */
async function stubSse(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeEventSource extends EventTarget {
      static instances: FakeEventSource[] = []
      readyState = 1
      url: string
      constructor(url: string) {
        super()
        this.url = url
        FakeEventSource.instances.push(this)
        setTimeout(() => this.dispatchEvent(new Event('open')), 0)
      }
      close(): void {
        this.readyState = 2
      }
    }
    ;(window as unknown as { EventSource: unknown }).EventSource = FakeEventSource
    ;(window as unknown as { __sseEmit: unknown }).__sseEmit = (
      topic: string,
      event: string,
      data: unknown,
    ): void => {
      const payload = JSON.stringify({ topic, event, data })
      for (const es of FakeEventSource.instances) {
        es.dispatchEvent(new MessageEvent('msg', { data: payload }))
      }
    }
  })
}

async function stubChat(page: Page, pid: string): Promise<void> {
  await page.route(`**/api/projects/${pid}/sessions`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      json: [
        { id: SESSION, title: 'tool output chat', kind: 'claude', createdAt: 1, updatedAt: 1 },
      ],
    })
  })
  await page.route(`**/api/projects/${pid}/sessions/${SESSION}/messages`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      json: [
        {
          role: 'assistant',
          parts: [{ type: 'tool-use', name: 'Read', input: { file_path: '/tmp/a.ts' } }],
          ts: 1,
        },
        { role: 'user', parts: [{ type: 'tool-result', text: LONG_RESULT }], ts: 2 },
      ],
    })
  })
}

/** Push assistant text deltas down the session topic, as a running turn would. */
async function streamDeltas(page: Page, pid: string, deltas: string[]): Promise<void> {
  for (const delta of deltas) {
    await page.evaluate(
      ([topic, text]) => {
        ;(window as unknown as { __sseEmit: (t: string, e: string, d: unknown) => void }).__sseEmit(
          topic,
          'session-msg',
          { type: 'text', delta: text },
        )
      },
      [`project:${pid}:session:${SESSION}`, delta] as const,
    )
    // Longer than STREAM_FLUSH_MS (80): force a separate flush per delta, so the
    // tool tree is recomputed several times rather than once.
    await page.waitForTimeout(140)
  }
}

test('工具输出超长时二级折叠，且流式更新中保持展开与滚动位置', async ({ page, request }) => {
  const pid = await resolveProjectId(request)
  await stubSse(page)
  await stubChat(page, pid)
  await page.goto(`/${pid}`)

  const row = page
    .locator('ul.list-none.border-t > li > button[title]')
    .filter({ hasText: 'tool output chat' })
    .first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  // --- first level: the run is collapsed to one line ---
  const toolRow = page.getByText('[工具] ×1')
  await expect(toolRow).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(HEAD_MARK)).toBeHidden()

  await toolRow.click()

  // --- second level: a 811-char result opens to a preview, not the whole thing ---
  await expect(page.getByText(HEAD_MARK)).toBeVisible()
  await expect(page.getByText(TAIL_MARK)).toBeHidden()
  const expandBtn = page.getByRole('button', { name: /展开全部/ })
  await expect(expandBtn).toBeVisible()

  await expandBtn.click()
  await expect(page.getByText(TAIL_MARK)).toBeVisible()
  await expect(page.getByRole('button', { name: '收起' })).toBeVisible()

  // The scroll box is the tool panel; park it away from the top.
  const box = page.locator('div.max-h-\\[32rem\\].overflow-auto').first()
  await expect(box).toBeVisible()
  const parked = await box.evaluate((el) => {
    el.scrollTop = 40
    return el.scrollTop
  })
  expect(parked).toBeGreaterThan(0)

  // --- the regression: keep talking, and none of the above may unwind ---
  await streamDeltas(page, pid, ['agent ', 'keeps ', 'streaming ', 'while you read'])
  await expect(page.getByText('agent keeps streaming while you read')).toBeVisible()

  // Still open at both levels…
  await expect(page.getByText(TAIL_MARK)).toBeVisible()
  await expect(page.getByRole('button', { name: '收起' })).toBeVisible()
  // …and still parked where the reader left it.
  expect(await box.evaluate((el) => el.scrollTop)).toBe(parked)
})
