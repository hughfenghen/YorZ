import { defineConfig } from 'vitest/config'
import { builtinModules } from 'node:module'
import { chmod } from 'node:fs/promises'
import { resolve } from 'node:path'

const SHEBANG = '#!/usr/bin/env node\n'

export default defineConfig({
  build: {
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, 'src/cli/index.ts'),
      formats: ['es'],
      fileName: () => 'cli/index.js',
    },
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        'commander',
        'hono',
        /^hono\//,
        '@hono/node-server',
        'chokidar',
        'gray-matter',
        '@anthropic-ai/claude-agent-sdk',
        '@openai/codex-sdk',
        '@opencode-ai/sdk',
        'markdown-it',
        /^markdown-it\//,
        'mermaid',
        'jsdom',
        'trash',
      ],
      output: {
        banner: SHEBANG,
      },
    },
  },
  plugins: [
    {
      name: 'yorz:post-build',
      async closeBundle() {
        const outFile = resolve(__dirname, 'dist/cli/index.js')
        await chmod(outFile, 0o755)
        // Skill files (src/skill/yorz-spec/**) are inlined into the CLI bundle
        // via import.meta.glob in src/cli/install.ts, so no on-disk copy is needed.
      },
    },
  ],
  // 单测里 src/gui/src/lib/*.ts 已改为指向 @shared 的 re-export shim，
  // vitest 需要同样的别名才能解析。
  resolve: {
    alias: [
      { find: '@shared', replacement: resolve(__dirname, 'src/gui-shared') },
      { find: '@', replacement: resolve(__dirname, 'src/gui/src') },
      // `solid-js` 的 exports 里 node 条件指向 dist/server.js —— 那份构建的
      // createEffect 是空函数。共享逻辑层（chat-transcript）的不变量全都长在
      // effect 上，用 server 构建跑单测等于什么都没测，因此显式指向浏览器构建。
      // 精确匹配（`^solid-js$`）：`solid-js/store` 之类的子路径不能被前缀替换掉。
      // 服务端代码不 import solid-js，这条别名对其余单测是死代码。
      {
        find: /^solid-js$/,
        replacement: resolve(__dirname, 'node_modules/solid-js/dist/solid.js'),
      },
    ],
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    // Real-Agent driven cases live under src/skill/yorz-spec/__tests__/ and are
    // intentionally excluded from `pnpm test`; they run via `pnpm test:agent`.
    exclude: ['node_modules/**', 'dist/**', 'src/skill/yorz-spec/__tests__/**'],
  },
})
