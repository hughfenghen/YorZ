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
