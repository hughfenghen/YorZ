/**
 * Second-level collapse for a single tool's input or result.
 *
 * The `[Tool] ×N` row is the first level — it hides the run entirely. But
 * opening it used to dump every payload in full, and a single `Read` result is
 * routinely thousands of lines: the panel became a keyhole onto a book. This is
 * the second level — each payload shows a head-of-text preview until asked for
 * the rest.
 *
 * Head, not tail — the opposite of `command-output.ts`'s `capText`. That one
 * caps a live command stream, where the newest lines are the point; a tool
 * result's first lines are the point (the file's opening, the first matches).
 *
 * Lives in `lib/` because vitest only covers `src/**\/*.test.ts` in a node
 * environment — logic in a `.tsx` component is untestable.
 */

/** Payloads longer than this collapse to a preview. */
export const TOOL_TEXT_PREVIEW_LIMIT = 300

export interface ToolTextView {
  /** Whether `preview` is a prefix of the text rather than all of it. */
  truncated: boolean
  /** What to render while collapsed — the whole text when it fits. */
  preview: string
  /** Full length, shown in the expand affordance so the cost is visible. */
  length: number
}

export function toolTextView(text: string, limit = TOOL_TEXT_PREVIEW_LIMIT): ToolTextView {
  const length = text.length
  if (length <= limit) return { truncated: false, preview: text, length }
  return { truncated: true, preview: text.slice(0, limit), length }
}
