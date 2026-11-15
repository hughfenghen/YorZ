import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

interface ProjectConfigResponse {
  agent: { kind: string; model?: string; reasoningEffort?: string }
  specsDir: string
}

const MODELS = Array.from({ length: 12 }, (_, index) => {
  const number = index + 1
  return {
    id: `fake-model-${number}`,
    displayName: `Long Model ${number} with a name that should truncate cleanly`,
    reasoningEfforts: [
      { id: 'low', displayName: 'low' },
      { id: 'high', displayName: 'high' },
    ],
  }
})

const CATALOG = {
  models: MODELS,
  defaultReasoningEfforts: [
    { id: 'low', displayName: 'low' },
    { id: 'high', displayName: 'high' },
  ],
}

async function resolveProjectId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/projects')
  expect(response.status()).toBe(200)
  const projects = (await response.json()) as Array<{ id: string; name?: string }>
  return (projects.find((project) => project.name === '.tmp-e2e') ?? projects[0]!).id
}

async function getProjectConfig(
  request: APIRequestContext,
  projectId: string,
): Promise<ProjectConfigResponse> {
  const response = await request.get(`/api/projects/${encodeURIComponent(projectId)}/config`)
  expect(response.status()).toBe(200)
  return response.json() as Promise<ProjectConfigResponse>
}

async function putProjectConfig(
  request: APIRequestContext,
  projectId: string,
  config: Pick<ProjectConfigResponse, 'agent' | 'specsDir'>,
): Promise<void> {
  const response = await request.put(`/api/projects/${encodeURIComponent(projectId)}/config`, {
    data: config,
  })
  expect(response.status()).toBe(200)
}

async function openProjectConfig(page: Page, projectId: string): Promise<void> {
  await page.goto(`/${projectId}`)
  await page.keyboard.press('Control+Shift+S')
}

test('桌面项目配置自动保存并为长模型列表提供筛选', async ({ page, request }) => {
  const projectId = await resolveProjectId(request)
  const original = await getProjectConfig(request, projectId)

  await page.route(/\/api\/projects\/[^/]+\/agents\/[^/]+\/models$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG) }),
  )
  await openProjectConfig(page, projectId)
  const dialog = page.getByRole('dialog').filter({ hasText: /项目配置|Project Config/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /保存|Save/, exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /取消|Cancel/, exact: true })).toHaveCount(0)

  await dialog.getByLabel('Agent', { exact: true }).click()
  await page.getByRole('option', { name: 'Codex', exact: true }).click()
  await expect
    .poll(async () => (await getProjectConfig(request, projectId)).agent.kind)
    .toBe('codex')

  const modelTrigger = dialog.getByRole('button', { name: /模型|Model/, exact: true })
  await expect(modelTrigger).toBeEnabled()
  await modelTrigger.click()
  const filter = page.getByPlaceholder(/筛选选项|Filter options/)
  await filter.fill('fake-model-11')
  await page.getByTitle(MODELS[10]!.displayName).click()
  await expect
    .poll(async () => (await getProjectConfig(request, projectId)).agent.model)
    .toBe('fake-model-11')

  const specsDir = dialog.getByLabel(/spec 文档目录|Spec directory/)
  await specsDir.fill('.yorz/specs-auto')
  await specsDir.press('Enter')
  await expect
    .poll(async () => (await getProjectConfig(request, projectId)).specsDir)
    .toBe('.yorz/specs-auto')

  await putProjectConfig(request, projectId, {
    agent: original.agent,
    specsDir: original.specsDir,
  })
})

test('桌面项目配置在模型目录冷加载期间展示加载中', async ({ page, request }) => {
  const projectId = await resolveProjectId(request)
  const original = await getProjectConfig(request, projectId)
  await putProjectConfig(request, projectId, {
    agent: { kind: 'codex' },
    specsDir: original.specsDir,
  })

  // 慢响应模拟 opencode 冷启动拉模型目录：加载期间模型行必须展示 loading，
  // 而不是只把控件禁用、让用户看到空下拉。
  await page.route(/\/agents\/[^/]+\/models$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CATALOG),
    })
  })

  await openProjectConfig(page, projectId)
  const dialog = page.getByRole('dialog').filter({ hasText: /项目配置|Project Config/ })
  const loadingRow = dialog
    .getByRole('button')
    .filter({ hasText: /加载中|Loading/ })
    .first()
  await expect(loadingRow).toBeVisible()
  await expect(loadingRow).toHaveAttribute('aria-busy', 'true')

  // 目录返回后恢复可交互，并能列出候选（筛选态是模型多于 10 个时的 Popover 分支）。
  const modelTrigger = dialog.getByRole('button', { name: /模型|Model/, exact: true })
  await expect(modelTrigger).toBeEnabled({ timeout: 10_000 })
  await modelTrigger.click()
  await expect(page.getByTitle(MODELS[0]!.displayName)).toBeVisible()

  await putProjectConfig(request, projectId, {
    agent: original.agent,
    specsDir: original.specsDir,
  })
})

test('移动端异步候选最终回显服务器配置并可筛选模型', async ({ page, request }) => {
  const projectId = await resolveProjectId(request)
  const original = await getProjectConfig(request, projectId)
  await putProjectConfig(request, projectId, {
    agent: { kind: 'codex', model: 'fake-model-11', reasoningEffort: 'high' },
    specsDir: original.specsDir,
  })

  await page.route(new RegExp(`/api/projects/${projectId}/agents$`), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'codex',
          displayName: 'Codex',
          source: 'builtin',
          capabilities: { listSessions: true, getMessages: true, usageStatus: true },
        },
      ]),
    })
  })
  await page.route(new RegExp(`/api/projects/${projectId}/agents/codex/models$`), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CATALOG),
    })
  })

  await page.goto('/m/settings/project')
  // 移动端 AgentSettings 渲染的是按钮行（不是原生 select），断言回显文案而非 value。
  await expect(page.getByLabel(/Agent 类型|Agent kind/)).toContainText('Codex')
  const modelTrigger = page.getByRole('button', { name: /模型|Model/, exact: true })
  await expect(modelTrigger).toContainText('Long Model 11')
  await expect(page.getByLabel(/推理强度|Reasoning effort/)).toContainText('high')

  await modelTrigger.click()
  const sheet = page.getByRole('dialog', { name: /模型|Model/ })
  await sheet.getByPlaceholder(/筛选选项|Filter options/).fill('fake-model-12')
  await sheet.getByTitle(MODELS[11]!.displayName).click()
  await expect
    .poll(async () => (await getProjectConfig(request, projectId)).agent.model)
    .toBe('fake-model-12')

  await putProjectConfig(request, projectId, {
    agent: original.agent,
    specsDir: original.specsDir,
  })
})
