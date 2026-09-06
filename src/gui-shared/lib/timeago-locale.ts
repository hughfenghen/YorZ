/**
 * Compact English relative-time locale for timeago.js.
 *
 * The stock `en_US` pack renders "5 minutes ago", which overflows the narrow
 * right-aligned timestamp column of the chat session list. This pack keeps the
 * same semantics with unit abbreviations: "5m ago", "3h ago", "2d ago".
 */

/** timeago.js locale: index 0..13 selects the unit, `%s` is the amount. */
type LocaleTuple = [string, string]

const DICT: LocaleTuple[] = [
  ['just now', 'right now'],
  ['%ss ago', 'in %ss'],
  ['1m ago', 'in 1m'],
  ['%sm ago', 'in %sm'],
  ['1h ago', 'in 1h'],
  ['%sh ago', 'in %sh'],
  ['1d ago', 'in 1d'],
  ['%sd ago', 'in %sd'],
  ['1w ago', 'in 1w'],
  ['%sw ago', 'in %sw'],
  ['1mo ago', 'in 1mo'],
  ['%smo ago', 'in %smo'],
  ['1y ago', 'in 1y'],
  ['%sy ago', 'in %sy'],
]

export function enShort(_diff: number, index: number): LocaleTuple {
  return DICT[index] ?? DICT[0]
}
