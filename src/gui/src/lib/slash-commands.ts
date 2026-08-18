import type { CustomInstruction } from './api.js'

/** Where a custom slash command is stored. */
export type SlashCommandScope = 'project' | 'global'

/** A custom instruction tagged with the config it came from. */
export interface ScopedInstruction extends CustomInstruction {
  scope: SlashCommandScope
}

/**
 * Text dropped into the composer when a custom command is picked.
 *
 * The `/name` prefix is always kept: the server resolves a command by the
 * leading `/name` of the sent text, so a bare prefill would silently detach the
 * command's hidden prompt (and could even collide with another command's name).
 * Idempotent for prefills that already start with the command — users wrote
 * those by hand to work around exactly this.
 *
 * The prefill is intentionally not trimmed: a trailing space lets the user keep
 * typing right where the prefill ends.
 */
export function buildSlashReplacement(name: string, prefill: string): string {
  const prefix = `/${name}`
  if (!prefill.trim()) return `${prefix} `
  if (startsWithCommand(prefill, name)) return prefill
  return `${prefix} ${prefill}`
}

function startsWithCommand(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^/${escaped}(\\s|$)`).test(text.trimStart())
}

/**
 * Merge both scopes for the picker. Mirrors the server-side merge: project
 * entries come first and shadow a global command with the same name, so what
 * the user picks is what the server resolves.
 */
export function mergeScopedInstructions(
  project: readonly CustomInstruction[],
  global: readonly CustomInstruction[],
): ScopedInstruction[] {
  const names = new Set(project.map((item) => item.name))
  return [
    ...project.map((item) => ({ ...item, scope: 'project' as const })),
    ...global
      .filter((item) => !names.has(item.name))
      .map((item) => ({ ...item, scope: 'global' as const })),
  ]
}
