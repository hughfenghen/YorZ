export interface NewSessionCommand {
  /** Empty means: arm the current group and wait for the next real message. */
  content: string
}

/** Match the builtin command name exactly; `/newer` remains an ordinary message. */
export function parseNewSessionCommand(input: string): NewSessionCommand | null {
  const match = /^\/new(?:\s+([\s\S]*))?$/.exec(input.trim())
  if (!match) return null
  return { content: (match[1] ?? '').trim() }
}
