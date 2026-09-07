import { createSignal, onCleanup, type Accessor } from 'solid-js'
import { api } from '../api/index.js'

/** Desktop default. Mobile passes a larger value — see `CompletionOptions.searchDebounceMs`. */
export const SEARCH_DEBOUNCE_MS = 150

const FUZZY_SCORE_MATCH = 16
const FUZZY_SCORE_PREFIX = 48
const FUZZY_SCORE_CONSECUTIVE = 24
const FUZZY_SCORE_BOUNDARY = 8

export interface SlashCommand {
  value: string
  label?: string
  description?: string
  replacement?: string
  action?: 'add'
  customId?: string
  editable?: boolean
  editLabel?: string
  deletable?: boolean
  deleteLabel?: string
  icon?: 'plus'
}

export type CompletionItem =
  | { kind: 'mention'; value: string }
  | {
      kind: 'slash'
      value: string
      label: string
      description?: string
      replacement?: string
      action?: 'add'
      customId?: string
      editable?: boolean
      editLabel?: string
      deletable?: boolean
      deleteLabel?: string
      icon?: 'plus'
      command: SlashCommand
    }

interface ScoredSlashCommand {
  cmd: SlashCommand
  score: number
  index: number
}

/**
 * What the caret is currently sitting in.
 *
 * `slash` only ever matches from offset 0 — a `/` mid-text is a path separator,
 * not a command. `mention` carries its own start offset because an `@` can begin
 * anywhere.
 */
export type Trigger =
  | { kind: 'slash'; query: string }
  | { kind: 'mention'; start: number; query: string }
  | null

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '')
}

function isFuzzyBoundary(target: string, index: number): boolean {
  if (index === 0) return true
  return /[\s/_.-]/.test(target[index - 1] ?? '')
}

export function scoreFuzzyText(query: string, target: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let score = 0
  let lastIndex = -1

  for (let qi = 0; qi < q.length; qi++) {
    const nextIndex = t.indexOf(q[qi]!, lastIndex + 1)
    if (nextIndex === -1) return null

    score += FUZZY_SCORE_MATCH
    if (nextIndex === qi) score += FUZZY_SCORE_PREFIX
    if (nextIndex === lastIndex + 1) score += FUZZY_SCORE_CONSECUTIVE
    if (isFuzzyBoundary(target, nextIndex)) score += FUZZY_SCORE_BOUNDARY
    score -= Math.max(0, nextIndex - lastIndex - 1)
    lastIndex = nextIndex
  }

  return score - target.length * 0.01
}

export function scoreFuzzySlashCommand(query: string, cmd: SlashCommand): number | null {
  const q = stripLeadingSlash(query.trim())
  if (!q) return 0
  const valueScore = scoreFuzzyText(q, stripLeadingSlash(cmd.value))
  const labelScore = cmd.label ? scoreFuzzyText(q, stripLeadingSlash(cmd.label)) : null
  if (valueScore == null) return labelScore
  if (labelScore == null) return valueScore
  return Math.max(valueScore, labelScore)
}

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands
  return commands
    .map<ScoredSlashCommand | null>((cmd, index) => {
      const score = scoreFuzzySlashCommand(query, cmd)
      return score == null ? null : { cmd, score, index }
    })
    .filter((entry): entry is ScoredSlashCommand => entry != null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.cmd)
}

/**
 * Classify the caret position. Pure, so both shells share one definition of
 * "this looks like a command" / "this still looks like a path fragment".
 *
 * `slashEnabled` is false for hosts that only want `@` (spec annotation, append
 * task): without it a leading `/` would open an empty command popup there.
 */
export function detectTrigger(text: string, pos: number, slashEnabled: boolean): Trigger {
  const head = text.slice(0, pos)

  if (slashEnabled && /^\/[\w-]*$/.test(head)) {
    return { kind: 'slash', query: head.slice(1) }
  }

  const atIdx = head.lastIndexOf('@')
  if (atIdx === -1) return null
  const afterAt = head.slice(atIdx + 1)
  // Anything outside the path alphabet means the user moved on past the mention.
  if (!/^[\w./@-]*$/.test(afterAt)) return null
  return { kind: 'mention', start: atIdx, query: afterAt }
}

export interface CompletionApply {
  next: string
  cursorPos: number
}

/**
 * Splice the picked completion over the trigger's span.
 *
 * The span is `1 + query.length` (the sigil plus what was typed), never the
 * caret position — trailing text after the caret must survive.
 */
export function applyCompletion(
  value: string,
  trigger: NonNullable<Trigger>,
  replacement: string,
): CompletionApply {
  const start = trigger.kind === 'slash' ? 0 : trigger.start
  const before = value.slice(0, start)
  const after = value.slice(start + 1 + trigger.query.length)
  return { next: before + replacement + after, cursorPos: before.length + replacement.length }
}

/** Text a picked item drops into the composer. */
export function replacementFor(item: CompletionItem): string {
  if (item.kind === 'mention') return `@${item.value}`
  return item.replacement ?? `${item.value} `
}

export type SelectOutcome =
  /** `/add-command`: the query was stripped, the host opens its own dialog. */
  | { kind: 'action'; command: SlashCommand }
  /** Text was replaced; the host restores focus and the caret. */
  | { kind: 'text'; cursorPos: number }
  /** Nothing was open — the click raced the close. */
  | { kind: 'noop' }

export interface CompletionOptions {
  /** Empty id disables mention search: no project scope to search in. */
  projectId: Accessor<string>
  value: Accessor<string>
  onValueChange: (next: string) => void
  /** Omit to disable `/` entirely (mention-only hosts). */
  slashCommands?: Accessor<SlashCommand[]>
  /**
   * Keep the popup open on a `/` query that matched nothing, so it reads as "no
   * such command" instead of "commands are broken". The host supplies the label,
   * so this layer stays i18n-free.
   */
  slashEmptyEnabled?: Accessor<boolean>
  /** Mention search debounce. Mobile wants this higher — each call is a live directory walk. */
  searchDebounceMs?: number
}

export interface CompletionController {
  open: Accessor<boolean>
  items: Accessor<CompletionItem[]>
  index: Accessor<number>
  setIndex: (i: number) => void
  /** Popup is open on a `/` query that matched nothing. */
  slashEmpty: Accessor<boolean>
  /** Feed every input event; re-classifies the caret and refreshes the list. */
  handleInput: (el: HTMLTextAreaElement) => void
  select: (item: CompletionItem) => SelectOutcome
  close: () => void
  /** Wraps around, for ArrowUp/Down hosts. */
  moveIndex: (delta: number) => void
  /** Drop a deleted custom command from the open list; closes if it was the last. */
  removeSlashItem: (customId: string) => void
}

/**
 * Headless `@` file completion + `/` command picker.
 *
 * Deliberately owns no DOM and no positioning: the desktop popup anchors above
 * the textarea, the mobile one is a full-width bar pinned over the composer, and
 * neither needs caret coordinates. Hosts render `items()` however they like.
 */
export function createCompletion(options: CompletionOptions): CompletionController {
  const [open, setOpen] = createSignal(false)
  const [items, setItems] = createSignal<CompletionItem[]>([])
  const [index, setIndex] = createSignal(0)
  const [slashEmpty, setSlashEmpty] = createSignal(false)

  /** The trigger the current `items()` belong to; null whenever the popup is shut. */
  let trigger: Trigger = null
  let timer: ReturnType<typeof setTimeout> | null = null

  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  function close(): void {
    setOpen(false)
    setSlashEmpty(false)
    setItems([])
    setIndex(0)
    trigger = null
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function debouncedSearch(query: string): void {
    if (timer) clearTimeout(timer)
    // Deliberately uncached: an agent run rewrites the tree under us, and a stale
    // path list here is worse than one extra walk.
    timer = setTimeout(async () => {
      const pid = options.projectId()
      if (!pid) return
      try {
        const result = await api.listFiles(pid, query)
        // A slower response for an abandoned query must not overwrite the live one.
        if (trigger?.kind !== 'mention' || trigger.query !== query) return
        setItems(result.items.map((value) => ({ kind: 'mention' as const, value })))
        setIndex(0)
      } catch {
        setItems([])
      }
    }, options.searchDebounceMs ?? SEARCH_DEBOUNCE_MS)
  }

  function openSlash(query: string): void {
    const commands = options.slashCommands?.() ?? []
    const next = filterSlashCommands(commands, query).map((cmd) => ({
      kind: 'slash' as const,
      value: cmd.value,
      label: cmd.label ?? cmd.value,
      description: cmd.description,
      replacement: cmd.replacement,
      action: cmd.action,
      customId: cmd.customId,
      editable: cmd.editable,
      editLabel: cmd.editLabel,
      deletable: cmd.deletable,
      deleteLabel: cmd.deleteLabel,
      icon: cmd.icon,
      command: cmd,
    }))
    setItems(next)
    setIndex(0)
    if (next.length > 0) {
      setSlashEmpty(false)
      setOpen(true)
    } else if (options.slashEmptyEnabled?.()) {
      setSlashEmpty(true)
      setOpen(true)
    } else {
      close()
    }
  }

  function handleInput(el: HTMLTextAreaElement): void {
    const slashEnabled = (options.slashCommands?.() ?? []).length > 0
    const next = detectTrigger(el.value, el.selectionStart, slashEnabled)
    if (!next) {
      close()
      return
    }
    trigger = next
    if (next.kind === 'slash') {
      openSlash(next.query)
      return
    }
    setSlashEmpty(false)
    if (!open()) setOpen(true)
    debouncedSearch(next.query)
  }

  function select(item: CompletionItem): SelectOutcome {
    const active = trigger
    if (!active) return { kind: 'noop' }

    if (item.kind === 'slash' && item.action === 'add') {
      // Strip the `/query` but insert nothing: the host opens a dialog instead.
      const { next } = applyCompletion(options.value(), active, '')
      options.onValueChange(next)
      close()
      return { kind: 'action', command: item.command }
    }

    const { next, cursorPos } = applyCompletion(options.value(), active, replacementFor(item))
    options.onValueChange(next)
    close()
    return { kind: 'text', cursorPos }
  }

  function moveIndex(delta: number): void {
    const list = items()
    if (list.length === 0) return
    setIndex((i) => (i + delta + list.length) % list.length)
  }

  function removeSlashItem(customId: string): void {
    if (!customId) return
    const next = items().filter((c) => c.kind !== 'slash' || c.customId !== customId)
    setItems(next)
    setIndex((current) => Math.min(current, Math.max(0, next.length - 1)))
    if (next.length === 0) close()
  }

  return {
    open,
    items,
    index,
    setIndex,
    slashEmpty,
    handleInput,
    select,
    close,
    moveIndex,
    removeSlashItem,
  }
}
