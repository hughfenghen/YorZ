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
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Real-Agent driven cases live under src/skill/yorz-spec/__tests__/ and are
    // intentionally excluded from `pnpm test`; they run via `pnpm test:agent`.
    exclude: ['node_modules/**', 'dist/**', 'src/skill/yorz-spec/__tests__/**'],
  },
})
