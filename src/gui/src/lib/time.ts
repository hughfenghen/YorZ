/**
 * Display formatting for spec frontmatter `updated_at`.
 *
 * Service writes `YYYY-MM-DD HH:mm:ss` (quoted in YAML); legacy specs may
 * still carry `YYYY-MM-DD`. Either form is rendered as-is, with quotes
 * stripped just in case a raw YAML scalar with surrounding quotes leaks
 * through. Any other shape falls back to the original string.
 */
export function formatSpecUpdatedAt(value: string | undefined | null): string {
  if (!value) return ''
  const stripped = value.replace(/^['"]|['"]$/g, '').trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stripped)) return stripped
  if (/^\d{4}-\d{2}-\d{2}$/.test(stripped)) return stripped
  return stripped || ''
}
