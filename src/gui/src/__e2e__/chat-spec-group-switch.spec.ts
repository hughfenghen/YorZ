import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * Regression: switching away from a RUNNING spec row and back left the message
 * area permanently blank.
 *
 * The read of the spec's aggregated transcript is slower than the session-list
 * refetch that `selectSession()` fires alongside it, so the list response
 * routinely lands INSIDE the read window. That re-ran the history effect, whose
 * cleanup cancelled the in-flight read — and the plan it then produced was
 * `keep`, which starts nothing. The area had already been blanked by
 * `clear: true`, so it stayed empty for the rest of the round with no pending
 * request left to explain it.
 *
 * Everything below the route stubs is production code. The stubs only pin the
 * timing that makes the race deterministic: the list is slow, the transcript is
 * slower still, so a cancel-on-re-run regression blanks the panel every time.
 */

const SPEC_ID = '260901.feat.e2e-chat-group'
const ROUND_A = 'e2e-round-a'
const ROUND_B = 'e2e-round-b'
const PLAIN = 'e2e-plain-chat'
const GROUP_MARK = 'ROUND-A-CONTENT'
const PLAIN_MARK = 'PLAIN-CHAT-CONTENT'

/** Slow enough that any list response fired by the click lands mid-read. */
const TRANSCRIPT_DELAY_MS = 700
const LIST_DELAY_MS = 250

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function msg(text: string) {
  return { role: 'assistant' as const, parts: [{ type: 'text' as const, text }], ts: 1 }
}

async function resolveProjectId(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/projects')
  expect(res.status()).toBe(200)
  const list = (await res.json()) as Array<{ id: string }> | { projects: Array<{ id: string }> }
  const arr = Array.isArray(list) ? list : list.projects
  expect(arr.length).toBeGreaterThan(0)
  return arr[0]!.id
}

async function stubChat(page: Page, pid: string): Promise<void> {
  const sessions = [
    {
      id: ROUND_B,
      title: 'spec round B',
      kind: 'claude',
      createdAt: 2,
      updatedAt: 2,
      specId: SPEC_ID,
      running: true,
    },
    {
      id: ROUND_A,
      title: 'spec round A',
      kind: 'claude',
      createdAt: 1,
      updatedAt: 1,
      specId: SPEC_ID,
    },
    { id: PLAIN, title: 'plain chat', kind: 'claude', createdAt: 3, updatedAt: 3 },
  ]

  await page.route(`**/api/projects/${pid}/sessions`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await sleep(LIST_DELAY_MS)
    await route.fulfill({ json: sessions })
  })
  await page.route(`**/api/projects/${pid}/specs/${SPEC_ID}/messages`, async (route) => {
    await sleep(TRANSCRIPT_DELAY_MS)
    await route.fulfill({
      json: [
        { sessionId: ROUND_A, kind: 'claude', createdAt: 1, messages: [msg(GROUP_MARK)] },
        { sessionId: ROUND_B, kind: 'claude', createdAt: 2, messages: [msg('ROUND-B-CONTENT')] },
      ],
    })
  })
  await page.route(`**/api/projects/${pid}/sessions/${PLAIN}/messages`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ json: [msg(PLAIN_MARK)] })
  })
}

test('切走再切回正在执行的 spec 行后，消息区仍应展示整组历史', async ({ page, request }) => {
  const pid = await resolveProjectId(request)
  await stubChat(page, pid)
  await page.goto(`/${pid}`)

  const rows = page.locator('ul.list-none.border-t > li > button[title]')
  const specRow = rows.filter({ hasText: 'spec round B' }).first()
  const plainRow = rows.filter({ hasText: 'plain chat' }).first()
  await expect(specRow).toBeVisible({ timeout: 10_000 })

  // Land on the running spec row: the whole group must render.
  await specRow.click()
  await expect(page.getByText(GROUP_MARK)).toBeVisible({ timeout: 10_000 })

  // Switch away…
  await plainRow.click()
  await expect(page.getByText(PLAIN_MARK)).toBeVisible({ timeout: 10_000 })

  // …and back. This is the switch that used to blank the panel for the rest of
  // the round: the list response lands inside the transcript read, and the plan
  // that follows it is `keep`.
  await specRow.click()
  await expect(page.getByText(GROUP_MARK)).toBeVisible({ timeout: 10_000 })
})
