import { describe, expect, it } from 'vitest'
import { pathWithoutV2Opencode, probeOpencodeGeneration } from '../agent-sdk/opencode-binary.js'

/**
 * 依赖本机真实 opencode 安装的检查，默认跳过。
 * 用 `OPENCODE_BINARY_LIVE=1 pnpm test` 打开。
 */
const live = process.env.OPENCODE_BINARY_LIVE === '1'

describe('opencode binary 探测（真实环境）', () => {
  it.skipIf(!live)(
    '区分 v1 与 v2',
    async () => {
      expect(await probeOpencodeGeneration('/opt/homebrew/bin/opencode')).toBe('v1')
    },
    30_000,
  )

  it.skipIf(!live)(
    '把 PATH 上的 v2 opencode 摘掉',
    async () => {
      const bin = `${process.cwd()}/node_modules/.bin`
      const pathEnv = `${bin}:/opt/homebrew/bin:/usr/bin`
      const cleaned = await pathWithoutV2Opencode(pathEnv)
      expect(cleaned).not.toContain(bin)
      expect(cleaned).toContain('/opt/homebrew/bin')
    },
    30_000,
  )
})
