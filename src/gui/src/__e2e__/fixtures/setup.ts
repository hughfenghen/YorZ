// Playwright globalSetup. The seeding logic lives in the dependency-free `seed.mjs`
// so it can also run as a plain `node` command *before* `yorz serve` starts (see
// playwright.config.ts webServer.command), eliminating the registration race.
// This module re-exports the shared constants/builders that spec files import from
// `./fixtures/setup.js`, and keeps globalSetup as an idempotent second seed.
export {
  E2E_CWD,
  SPEC_ID,
  QUESTIONS_SPEC_ID,
  QUESTIONS_FREEFORM_SPEC_ID,
  TASK_LIST_SPEC_ID,
  SCROLL_SPEC_ID,
  SCROLL_TEXT_SPEC_ID,
  buildScrollSpec,
  buildScrollTextSpec,
  seed,
} from './seed.mjs'

import { seed } from './seed.mjs'

export default async function globalSetup(): Promise<void> {
  seed()
}
