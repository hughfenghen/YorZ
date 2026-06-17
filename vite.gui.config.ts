import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(__dirname, 'src/gui'),
  base: '/',
  plugins: [solid()],
  build: {
    outDir: resolve(__dirname, 'dist/gui'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7423',
    },
  },
})
