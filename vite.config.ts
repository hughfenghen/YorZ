import { defineConfig } from 'vitest/config'
import { builtinModules } from 'node:module'
import { chmod, copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const SHEBANG = '#!/usr/bin/env node\n'

export default defineConfig({
  build: {
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
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
        const skillDir = resolve(__dirname, 'dist/skill')
        await mkdir(skillDir, { recursive: true })
        await copyFile(
          resolve(__dirname, 'src/skill/SKILL.md'),
          resolve(skillDir, 'SKILL.md'),
        )
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
