import { describe, expect, it } from 'vitest'
import { OpenCodeAdapter } from '../agent-sdk/opencode-adapter.js'

/**
 * v1 适配器在「PATH 上的 `opencode` 其实是 v2」时仍要能工作。
 *
 * `@opencode/cli` 同时声明了 `opencode` 与 `opencode2` 两个 bin，装成全局包
 * （或在本仓库里 `pnpm dev`）会遮蔽用户原有的 v1 CLI。v1 适配器必须在启动前
 * 把 PATH 上的 v2 摘掉。
 */
describe('OpenCodeAdapter 在 v2 遮蔽下', () => {
  it.skipIf(process.env.OPENCODE_V1_LIVE !== '1')(
    '仍能连上 v1 服务端',
    async () => {
      const originalPath = process.env.PATH
      // 模拟「node_modules/.bin 排在前面」——那里现在放着 v2 的 opencode。
      process.env.PATH = `${process.cwd()}/node_modules/.bin:${originalPath ?? ''}`
      try {
        const adapter = new OpenCodeAdapter(process.cwd())
        const catalog = await adapter.listModels()
        expect(catalog.models.length).toBeGreaterThan(0)
        await adapter.dispose()
      } finally {
        process.env.PATH = originalPath
      }
    },
    120_000,
  )
})
