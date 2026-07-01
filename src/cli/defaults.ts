import type { InstallScope } from './adapters/types.js'

export const INSTALL_SCOPE_DEFAULT: InstallScope = 'user'

/**
 * Return the one-line tip printed by `yorz install skills` when the user
 * didn't explicitly pass `-s/--scope`, or `null` when the user did.
 * Kept as a pure helper so it can be exercised in unit tests without
 * spinning up commander.
 */
export function installScopeTip(scopeSource: string | undefined): string | null {
  if (scopeSource === 'default' || scopeSource === undefined) {
    return `[tip] defaulting to --scope ${INSTALL_SCOPE_DEFAULT} (global); pass -s project to install into this repo`
  }
  return null
}
