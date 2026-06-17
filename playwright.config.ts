import { defineConfig, devices } from '@playwright/test'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const E2E_PORT = 17430
const E2E_CWD = resolve(__dirname, '.tmp-e2e')

export default defineConfig({
  testDir: './src/gui/src/__e2e__',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  globalSetup: './src/gui/src/__e2e__/fixtures/setup.ts',
  use: {
    baseURL: `http://localhost:${E2E_PORT}/`,
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `node dist/cli/index.js serve --port ${E2E_PORT} --cwd ${E2E_CWD}`,
    url: `http://localhost:${E2E_PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
