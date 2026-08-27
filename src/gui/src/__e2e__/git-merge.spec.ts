import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const E2E_CWD = resolve(__dirname, '..', '..', '..', '..', '.tmp-e2e')

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

/**
 * `.tmp-e2e` lives inside this repository's working tree, so a repo of its own
 * is mandatory: without `git init` every git command here would walk up and
 * operate on the real YorZ checkout.
 */
test.beforeAll(() => {
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'e2e@example.com'])
  git(['config', 'user.name', 'E2E'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(E2E_CWD, 'shared.txt'), 'base\n', 'utf8')
  git(['add', 'shared.txt'])
  git(['commit', '-q', '-m', 'base'])

  // mergeable: fast-forwards cleanly. conflicting: rewrites the same line.
  git(['checkout', '-q', '-b', 'mergeable'])
  writeFileSync(join(E2E_CWD, 'added.txt'), 'added\n', 'utf8')
  git(['add', 'added.txt'])
  git(['commit', '-q', '-m', 'mergeable work'])
  git(['checkout', '-q', 'main'])

  git(['checkout', '-q', '-b', 'conflicting'])
  writeFileSync(join(E2E_CWD, 'shared.txt'), 'from-branch\n', 'utf8')
  git(['add', 'shared.txt'])
  git(['commit', '-q', '-m', 'conflicting work'])
  git(['checkout', '-q', 'main'])
  writeFileSync(join(E2E_CWD, 'shared.txt'), 'from-main\n', 'utf8')
  git(['add', 'shared.txt'])
  git(['commit', '-q', '-m', 'main work'])

  // A remote-tracking ref, created locally so the test stays offline.
  git(['update-ref', 'refs/remotes/origin/demo', git(['rev-parse', 'HEAD']).trim()])
})

test('合并分支：过滤保持展开、合并成功、冲突回滚并回显错误', async ({ page, request }) => {
  const projectId = await resolveProjectId(request)
  await page.goto(`/${projectId}/git`)

  const entry = page.getByRole('button', { name: '合并分支' })
  const filter = page.getByPlaceholder('过滤本地 / 远程分支…')
  const mergeAction = page.getByRole('button', { name: '合并', exact: true })

  // 1) 候选含本地 + 远程；键入过滤后下拉必须仍然展开
  await entry.click()
  await expect(page.getByRole('button', { name: 'mergeable' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'origin/demo' })).toBeVisible()
  await filter.click()
  await filter.pressSequentially('mergeab')
  await expect(filter).toHaveValue('mergeab')
  await expect(page.getByRole('button', { name: 'mergeable' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'origin/demo' })).toHaveCount(0)

  // 2) 选中候选后才出现「合并」按钮，点击后真正合并
  await expect(mergeAction).toHaveCount(0)
  await page.getByRole('button', { name: 'mergeable' }).click()
  await expect(mergeAction).toBeVisible()
  await mergeAction.click()
  await expect(page.getByText(/已将 mergeable 合并到 main/)).toBeVisible()
  // main 已在分叉后另有提交，故这里是 merge commit：断言祖先关系而非 HEAD 相等。
  expect(() => git(['merge-base', '--is-ancestor', 'mergeable', 'HEAD'])).not.toThrow()
  expect(existsSync(join(E2E_CWD, 'added.txt'))).toBe(true)

  // 3) 冲突分支：页面回显 git 原文与冲突文件，工作区不残留 MERGING 状态
  await entry.click()
  await filter.click()
  await filter.pressSequentially('conflict')
  await page.getByRole('button', { name: 'conflicting' }).click()
  await mergeAction.click()
  const errorLine = page.locator('p.text-destructive')
  await expect(errorLine).toContainText('shared.txt')
  await expect(errorLine).toContainText('CONFLICT')
  // 无冲突残留、无 MERGE_HEAD（.yorz/ 是 seed 留下的未跟踪目录，与合并无关）
  expect(git(['diff', '--name-only', '--diff-filter=U'])).toBe('')
  expect(existsSync(join(E2E_CWD, '.git', 'MERGE_HEAD'))).toBe(false)
  expect(git(['show', 'HEAD:shared.txt'])).toBe('from-main\n')
})
