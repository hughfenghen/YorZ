import { rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Repo root is five levels up from src/gui/src/__e2e__/fixtures.
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..')

/** Playwright globalTeardown: remove the seeded project dir and the isolated
 * YORZ_HOME so no `.tmp-e2e` / runtime state lingers on disk after the run. */
export default async function globalTeardown(): Promise<void> {
  rmSync(resolve(REPO_ROOT, '.tmp-e2e'), { recursive: true, force: true })
  rmSync(resolve(REPO_ROOT, '.tmp-e2e-home'), { recursive: true, force: true })
}
