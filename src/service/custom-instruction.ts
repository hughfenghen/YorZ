/**
 * A user-defined slash command. Lives in both the global config and a
 * project's `.yorz/config.json`; the two lists are merged per request by
 * {@link mergeCustomInstructions}.
 *
 * Owned by this module rather than by either config module so both can depend
 * on it without depending on each other.
 */
export interface CustomInstruction {
  id: string
  name: string
  description: string
  /**
   * Prompt text appended on send but never shown in the composer or the chat
   * bubble. Deliberately *not* an SDK system prompt: it rides the user message,
   * so the old `systemPrompt` name overstated its authority.
   */
  hiddenPrompt: string
  prefill: string
  createdAt: number
}

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
  instructions: readonly CustomInstruction[],
): CustomInstruction | null {
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
  instructions: readonly CustomInstruction[],
): string {
  const hit = matchCustomInstruction(prompt, instructions)
  if (!hit) return prompt
  return wrapHiddenPrompt(hit.hiddenPrompt, prompt)
}

/**
 * Drop malformed entries instead of rejecting the whole config: a hand-edited
 * config file must never make the app unusable. Route handlers validate more
 * strictly and surface errors to the caller.
 */
export function normalizeCustomInstructions(value: unknown): CustomInstruction[] {
  if (!Array.isArray(value)) return []
  const out: CustomInstruction[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id.trim() : ''
    const name = typeof obj.name === 'string' ? obj.name.trim().replace(/^\/+/, '') : ''
    if (!id || !name || seen.has(id) || !/^[\w-]+$/.test(name)) continue
    seen.add(id)
    out.push({
      id,
      name,
      description: typeof obj.description === 'string' ? obj.description : '',
      // Fall back to the pre-rename `systemPrompt` so existing configs keep
      // working; the next save rewrites them under the new key.
      hiddenPrompt:
        typeof obj.hiddenPrompt === 'string'
          ? obj.hiddenPrompt
          : typeof obj.systemPrompt === 'string'
            ? obj.systemPrompt
            : '',
      prefill: typeof obj.prefill === 'string' ? obj.prefill : '',
      createdAt: typeof obj.createdAt === 'number' && obj.createdAt > 0 ? obj.createdAt : 0,
    })
  }
  return out
}

/**
 * Strict counterpart of {@link normalizeCustomInstructions} for request
 * bodies: a client sending a malformed entry gets told why instead of having
 * it silently dropped. Shared by the global and project config routes.
 */
export function parseCustomInstructions(value: unknown): CustomInstruction[] | { error: string } {
  if (value === undefined) return []
  if (!Array.isArray(value)) return { error: 'customInstructions must be an array' }
  const out: CustomInstruction[] = []
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') {
      return { error: `customInstructions.${index} must be an object` }
    }
    const obj = item as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id.trim() : ''
    const name = typeof obj.name === 'string' ? obj.name.trim().replace(/^\/+/, '') : ''
    if (!id) return { error: `customInstructions.${index}.id required` }
    if (!name || !/^[\w-]+$/.test(name)) {
      return {
        error: `customInstructions.${index}.name must use letters, numbers, underscores, or hyphens`,
      }
    }
    if (seen.has(id)) return { error: `duplicate custom instruction id: ${id}` }
    seen.add(id)
    const description = obj.description
    // Accept the pre-rename `systemPrompt` key so an older GUI build can still
    // PUT successfully; responses always use `hiddenPrompt`.
    const hiddenPrompt = obj.hiddenPrompt ?? obj.systemPrompt
    const prefill = obj.prefill
    const createdAt = obj.createdAt
    if (typeof description !== 'string') {
      return { error: `customInstructions.${index}.description must be a string` }
    }
    if (typeof hiddenPrompt !== 'string') {
      return { error: `customInstructions.${index}.hiddenPrompt must be a string` }
    }
    if (typeof prefill !== 'string') {
      return { error: `customInstructions.${index}.prefill must be a string` }
    }
    if (typeof createdAt !== 'number' || createdAt <= 0) {
      return { error: `customInstructions.${index}.createdAt must be a positive number` }
    }
    out.push({ id, name, description, hiddenPrompt, prefill, createdAt })
  }
  return out
}

/**
 * Merge the two scopes into the list the picker shows and the send path
 * matches against.
 *
 * Project entries win and come first: `name` is the only key the send path can
 * resolve (`/name` in the composer), so letting both scopes keep a duplicate
 * name would make the match order-dependent and unexplainable to the user.
 */
export function mergeCustomInstructions(
  project: readonly CustomInstruction[],
  global: readonly CustomInstruction[],
): CustomInstruction[] {
  const names = new Set(project.map((item) => item.name))
  return [...project, ...global.filter((item) => !names.has(item.name))]
}
