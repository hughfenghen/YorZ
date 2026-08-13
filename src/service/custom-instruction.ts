import type { GlobalCustomInstruction } from './global-config.js'

/**
 * Marker pair wrapping a hidden prompt injected on behalf of a slash command.
 *
 * The Agent receives the whole text, while the GUI strips the block before
 * rendering. Because the user's original input is preserved verbatim *outside*
 * the markers, stripping yields exactly what was typed — so the optimistic
 * bubble written at send time and the bubble rebuilt from the Agent transcript
 * are byte-identical, with no extra display field in the message protocol.
 *
 * Keep in sync with the GUI copy in `src/gui/src/lib/chat-blocks.ts`.
 */
export const HIDDEN_PROMPT_OPEN = '<!-- yorz:hidden -->'
export const HIDDEN_PROMPT_CLOSE = '<!-- /yorz:hidden -->'

/** Non-greedy so several blocks in one message strip independently. */
const HIDDEN_PROMPT_RE = /<!-- yorz:hidden -->[\s\S]*?<!-- \/yorz:hidden -->\n?/g

const SLASH_NAME_RE = /^\/([\w-]+)(?:\s|$)/

/** Resolve the leading `/name` of a prompt against the configured instructions. */
export function matchCustomInstruction(
  prompt: string,
  instructions: readonly GlobalCustomInstruction[],
): GlobalCustomInstruction | null {
  const matched = SLASH_NAME_RE.exec(prompt.trim())
  if (!matched) return null
  const name = matched[1]
  return instructions.find((item) => item.name === name) ?? null
}

/**
 * Prepend `hidden` to `original` inside the marker block. An empty hidden
 * prompt is a no-op, so callers need not special-case unconfigured commands.
 */
export function wrapHiddenPrompt(hidden: string, original: string): string {
  const body = hidden.trim()
  if (!body) return original
  return [HIDDEN_PROMPT_OPEN, body, HIDDEN_PROMPT_CLOSE, original].join('\n')
}

/** Append a hidden block *after* the user's text (used for attachment lists). */
export function appendHiddenPrompt(original: string, hidden: string): string {
  const body = hidden.trim()
  if (!body) return original
  return [original, '', HIDDEN_PROMPT_OPEN, body, HIDDEN_PROMPT_CLOSE].join('\n')
}

/**
 * Inverse of {@link wrapHiddenPrompt} / {@link appendHiddenPrompt}; safe on
 * text that has no markers. Trims only when a block was actually removed, so
 * the result matches the already-trimmed prompt the composer sent.
 */
export function stripHiddenPrompt(text: string): string {
  if (!text.includes(HIDDEN_PROMPT_OPEN)) return text
  return text.replace(HIDDEN_PROMPT_RE, '').trim()
}

/**
 * Expand a chat prompt when it starts with a configured custom instruction.
 * Returns the prompt unchanged when nothing matches or the command carries no
 * hidden prompt.
 */
export function applyCustomInstruction(
  prompt: string,
  instructions: readonly GlobalCustomInstruction[],
): string {
  const hit = matchCustomInstruction(prompt, instructions)
  if (!hit) return prompt
  return wrapHiddenPrompt(hit.hiddenPrompt, prompt)
}
