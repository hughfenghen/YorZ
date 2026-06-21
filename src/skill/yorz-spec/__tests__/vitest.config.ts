import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../../..')

// Real-Agent driven cases: each `*.test.ts` here spawns `claude` / `opencode`
// (or whatever YORZ_AGENT_CMD points at) and asserts the round-tripped spec md.
// Wall-clock per case can be minutes — keep this isolated from the fast unit run.
export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['src/skill/yorz-spec/__tests__/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@yorz/cli': resolve(root, 'src/cli'),
      '@yorz/service': resolve(root, 'src/service'),
    },
  },
})
