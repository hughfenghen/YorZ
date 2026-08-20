import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureLogger } from './src/service/logger.js'

// Unit tests must never append to the developer's real
// `<globalConfigDir>/logs/serve.log`, and log mirroring would drown the vitest
// reporter. Redirect the process-wide logger into a throwaway temp dir.
configureLogger({
  dir: mkdtempSync(join(tmpdir(), 'yorz-test-logs-')),
  mirrorConsole: false,
})

// Telemetry resolves its directory from the environment on every write, so —
// unlike the logger — it cannot be redirected by a setter. Point YORZ_HOME at a
// throwaway dir so no test run appends to the developer's real
// `<globalConfigDir>/metrics`. Tests that need their own home still override it.
process.env.YORZ_HOME ??= mkdtempSync(join(tmpdir(), 'yorz-test-home-'))
