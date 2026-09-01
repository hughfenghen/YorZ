import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const E2E_CWD = resolve(__dirname, '..', '..', '..', '..', '.tmp-e2e')

const PROBE = 'git-status-initial-load.probe.txt'

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: E2E_CWD, encoding: 'utf8' })
}

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

test.beforeAll(() => {
  // `.tmp-e2e` sits inside this repository's working tree, so it needs a repo of
  // its own or every git call would walk up to the real YorZ checkout.
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'e2e@example.com'])
  git(['config', 'user.name', 'E2E'])
  // An untracked file always shows up in `git status`, whatever the branch state
  // left behind by other specs.
  writeFileSync(join(E2E_CWD, PROBE), 'probe\n', 'utf8')
})

/**
 * Regression: the git changes list must not depend on the one-shot SSE snapshot.
 *
 * The server emits that snapshot only when it *attaches* the topic, and it skips
 * topics the client is already subscribed to. A fast leave/re-enter of the page
 * collapses into a single debounced subscribe POST with an unchanged topic set,
 * so the remounted panel used to receive nothing and stayed stuck on an empty
 * list until the working tree changed (a page refresh, with its fresh clientId,
 * was the only way out).
 *
 * Cutting the event stream entirely reproduces that "no push will arrive" state
 * deterministically: the list may only come from the initial fetch.
 */
test('Git 状态页：SSE 无任何推送时，变更列表仍由初始拉取渲染', async ({ page, request }) => {
  const projectId = await resolveProjectId(request)

  // Sever the realtime channel: no snapshot, no updates — the fetch is the only
  // possible source of the list.
  await page.route('**/api/events/stream*', (route) => route.abort())
  await page.route('**/api/events/subscribe', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )

  await page.goto(`/${projectId}/git`)

  await expect(page.getByText(PROBE)).toBeVisible()
  await expect(page.getByRole('button', { name: '全选' })).toBeVisible()
})
