/**
 * Shared grammar for YorZ's built-in slash commands.
 *
 * Both `/yorz-spec` and `/yorz-debug` take the same shape:
 *
 *     /<name> [<spec path>] [<body>]
 *
 * The spec path is an optional *positional* argument rather than a flag, so a
 * dispatch YorZ synthesises internally (`/yorz-spec .yorz/specs/x/spec.md 加个夜间模式`)
 * and a line the user types in chat (`/yorz-spec 加个夜间模式`) parse with the
 * same function — the only difference is whether a target spec was named.
 *
 * Lives in its own module so `slash-command.ts` and `chat-debug.ts` can both
 * depend on it without importing each other.
 */

const COMMAND_RE = /^\/([\w-]+)(?:\s+([\s\S]*))?$/

/**
 * A bare token ending in `.md`, optionally carrying the `@` file-reference
 * marker YorZ's composer inserts. Deliberately narrow: chat bodies start with
 * prose ("加个夜间模式"), never with a lone markdown path, so this cannot
 * swallow the first word of a real bug description.
 *
 * The `@` is stripped on parse so every consumer downstream (notably
 * {@link specDirOf}, which derives `debug.md`'s home) sees a plain
 * project-relative path.
 */
const SPEC_PATH_RE = /^@?\S+\.md$/

/**
 * Anchors the spec path for the Agent. The prompt that carries it also names an
 * absolute skill path under the user's home directory, and without this line
 * agents resolve the neighbouring relative path against *that* directory (or
 * against `~`) and report the spec as missing.
 *
 * Defined here rather than in either prompt builder so `/yorz-spec` and
 * `/yorz-debug` state it identically.
 */
export const SPEC_PATH_ANCHOR_NOTE =
  '该 spec 路径是**项目根目录**（即你的当前工作目录）下的相对路径，' +
  '不要相对 skill 文件所在目录或用户主目录解析；命令行中的 `@` 只是文件引用标记，不属于路径本身。'

/**
 * `feat: …` / `fix：…` opening a body. Both colons are accepted because the
 * requirement text next to it is typed with a Chinese IME more often than not.
 *
 * Only consumed when no spec path was named: a path means the spec already
 * exists, and then its own frontmatter — not the command line — owns the type.
 */
const SPEC_TYPE_RE = /^(feat|refct|fix)\s*[:：]\s*([\s\S]*)$/

export type BuiltinSpecType = 'feat' | 'refct' | 'fix'

export interface ParsedBuiltinCommand {
  /** Command name without the leading slash. */
  name: string
  /** Target spec document, or `''` when the command named none. */
  specPath: string
  /** Spec type from a `<type>:` body prefix, or `''` when absent. */
  specType: BuiltinSpecType | ''
  /** Everything after the name, the optional spec path and type, trimmed. */
  body: string
}

/** `null` when the prompt does not open with a `/name` token at all. */
export function parseBuiltinCommand(prompt: string): ParsedBuiltinCommand | null {
  const matched = COMMAND_RE.exec(prompt.trim())
  if (!matched) return null
  const rest = (matched[2] ?? '').trim()
  const head = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest)
  if (head && SPEC_PATH_RE.test(head[1])) {
    // Body kept verbatim: with a path the type prefix carries no meaning, and
    // an append description may legitimately open with "fix: …".
    return {
      name: matched[1],
      specPath: stripMention(head[1]),
      specType: '',
      body: (head[2] ?? '').trim(),
    }
  }
  return { name: matched[1], specPath: '', ...splitSpecType(rest) }
}

function splitSpecType(rest: string): { specType: BuiltinSpecType | ''; body: string } {
  const typed = SPEC_TYPE_RE.exec(rest)
  if (!typed) return { specType: '', body: rest }
  return { specType: typed[1] as BuiltinSpecType, body: typed[2].trim() }
}

/**
 * Directory holding a spec document. Spec paths are always project-relative
 * with forward slashes (they are built from `specsDirRelative`), so this stays
 * platform-independent and does not need `node:path`.
 */
export function specDirOf(specPath: string): string {
  const cut = specPath.lastIndexOf('/')
  return cut > 0 ? specPath.slice(0, cut) : '.'
}

/** Drop the `@` file-reference marker, if present. Idempotent. */
function stripMention(specPath: string): string {
  return specPath.startsWith('@') ? specPath.slice(1) : specPath
}

/**
 * Join a command name, optional spec path and optional body into one line.
 *
 * The path goes out as `@<path>`, matching the composer's file-reference syntax
 * so a synthesised dispatch reads exactly like a line the user could have typed
 * with `@` autocomplete — and so the bubble marks it as a file of *this*
 * project. Idempotent for callers that already prefixed it.
 */
export function formatBuiltinCommand(name: string, specPath: string, body = ''): string {
  const mention = specPath ? `@${stripMention(specPath)}` : ''
  return [`/${name}`, mention, body.trim()].filter(Boolean).join(' ')
}

/** `/<name> <type>: <body>` — the form used when the spec does not exist yet. */
export function formatTypedBuiltinCommand(
  name: string,
  specType: BuiltinSpecType,
  body = '',
): string {
  return `/${name} ${specType}: ${body.trim()}`.trimEnd()
}
