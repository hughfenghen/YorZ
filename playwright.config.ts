import { defineConfig, devices } from '@playwright/test'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const E2E_PORT = 17430
const E2E_CWD = resolve(__dirname, '.tmp-e2e')
// Isolated global config dir for the e2e `serve`: keeps runtime.json / projects.json
// out of the user's real ~/.config/yorz. Cleaned up by globalTeardown.
const E2E_HOME = resolve(__dirname, '.tmp-e2e-home')
const E2E_PAIR_TOKEN = 'yorz-e2e-pair-token'
// Isolated OS home dir for the e2e `serve`: the directory picker lands on the service
// process's `os.homedir()` by default and has no path input, so add-project specs must
// be able to create fixtures inside HOME. Pointing it here keeps the real ~ untouched.
// Created by seed.mjs (runs before serve), removed by globalTeardown.
const E2E_FS_HOME = resolve(__dirname, '.tmp-e2e-fs-home')
const SEED_SCRIPT = resolve(__dirname, 'src/gui/src/__e2e__/fixtures/seed.mjs')

export default defineConfig({
  testDir: './src/gui/src/__e2e__',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  globalSetup: './src/gui/src/__e2e__/fixtures/setup.ts',
  globalTeardown: './src/gui/src/__e2e__/fixtures/teardown.ts',
  use: {
    // 127.0.0.1 (not localhost) so requests never resolve to ::1, which the
    // loopback-bound server (hostname 127.0.0.1) refuses.
    baseURL: `http://127.0.0.1:${E2E_PORT}/`,
    // Pin locale so i18next's navigator detector selects zh-CN; specs assert
    // Chinese labels (批注 / 解释 / 发送). Without this, Chromium's en-US default
    // renders the English bundle and those locators never match.
    locale: 'zh-CN',
    extraHTTPHeaders: { 'x-yorz-pair-token': E2E_PAIR_TOKEN },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${E2E_PORT}`,
          localStorage: [
            { name: 'yorz.token', value: E2E_PAIR_TOKEN },
            { name: 'yorz.m.token', value: E2E_PAIR_TOKEN },
          ],
        },
      ],
    },
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Seed .tmp-e2e/.yorz *before* serve starts so cwd registration succeeds
    // (webServer runs before globalSetup, so we can't rely on it here).
    command: `node ${SEED_SCRIPT} && node dist/cli/index.js serve --foreground --port ${E2E_PORT} --cwd ${E2E_CWD}`,
    url: `http://127.0.0.1:${E2E_PORT}/`,
    // USERPROFILE is what Node's os.homedir() reads on Windows; HOME on POSIX.
    env: { YORZ_HOME: E2E_HOME, HOME: E2E_FS_HOME, USERPROFILE: E2E_FS_HOME },
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
