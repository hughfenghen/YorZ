import {
  formatBuiltinCommand,
  formatTypedBuiltinCommand,
  parseBuiltinCommand,
  type BuiltinSpecType,
} from './builtin-command.js'
import { buildDebugPrompt, isYorzDebugCommand } from './chat-debug.js'
import { matchCustomInstruction, wrapHiddenPrompt } from './custom-instruction.js'
import type { GlobalCustomInstruction } from './global-config.js'
import { skillRef } from './skill-ref.js'

/**
 * Chat slash commands are a YorZ-only affordance: the composer offers them as
 * completions, but the Agent CLI has its own slash-command registry and treats
 * *any* prompt starting with `/` as one of its own. A YorZ command name is never
 * in that registry, so an unexpanded `/name` round-trips as `Unknown command`.
 *
 * Every prompt therefore leaves this module with something other than `/` in
 * front — always by wrapping guidance in a hidden block rather than by editing
 * the user's text, so `stripHiddenPrompt` still recovers the original input
 * verbatim and the chat bubble stays byte-identical to what was typed.
 */
export type BuiltinSlashCommand = 'yorz-debug' | 'yorz-spec'

export interface ResolvedChatPrompt {
  /** Prompt to hand the Agent; never starts with a slash command. */
  prompt: string
  /** Which built-in matched, for callers with per-command side effects. */
  builtin: BuiltinSlashCommand | null
}

const SLASH_NAME_RE = /^\/([\w-]+)(?:\s|$)/

const SPEC_COMMAND_RE = /^\/yorz-spec(?:\s|$)/

/** `true` when the prompt opens with something the Agent CLI would parse. */
export function isSlashCommand(prompt: string): boolean {
  return SLASH_NAME_RE.test(prompt.trim())
}

export interface SpecPromptOptions {
  /**
   * Draft attachments awaiting migration into the new spec directory. Only
   * meaningful for the new-spec branch — an existing spec keeps its own.
   */
  draftId?: string
}

/**
 * Expand `/yorz-spec [<spec path>] [<type>:] <body>` into skill guidance,
 * mirroring {@link buildDebugPrompt}: the guidance goes in a hidden block and
 * the command line stays outside it.
 *
 * Three branches, in the order the parser resolves them:
 * - spec path → point the agent straight at that document;
 * - no path but a `<type>:` prefix → the spec does not exist yet, so run the
 *   skill's new-spec flow with the type the caller already decided;
 * - neither → a bare chat invocation, where the skill's auto-mode decides
 *   between resuming a spec from the conversation and creating a new one.
 */
export function buildSpecPrompt(
  prompt: string,
  specsDirRelative: string,
  opts: SpecPromptOptions = {},
): string {
  const parsed = parseBuiltinCommand(prompt)
  const original = prompt.trim()
  const body = parsed?.body ?? ''
  const specPath = parsed?.specPath ?? ''
  const specType = parsed?.specType ?? ''

  const head = specPath
    ? [`${skillRef('yorz-spec')}，然后按其自动模式判定推进 spec：\`${specPath}\`。`]
    : specType
      ? [
          `${skillRef('yorz-spec')}，然后按其「新建 spec」流程创建新的 spec 文档，并立即按 plan 阶段继续推进直至阻塞。`,
          `类型：${specType}（已由调用方指定，不要再询问）。`,
          `spec 目录为 \`${specsDirRelative}/\`。`,
          ...buildDraftAttachmentGuide(specsDirRelative, opts.draftId),
        ]
      : [
          `${skillRef('yorz-spec')}，然后按其自动模式判定推进。`,
          `本次是普通 chat 独立触发，未指定 spec_path：若当前会话上下文中已出现过 spec 文档，继续推进该 spec；否则按 skill 的「新建 spec」流程创建后立即推进 plan 阶段。`,
          `spec 目录为 \`${specsDirRelative}/\`。`,
        ]

  // The new-spec branch has no `## 追加任务` to consume yet, so it gets its own
  // tail rather than inheriting the append wording.
  const tail = body
    ? specType && !specPath
      ? '本次需求见下方用户输入（忽略其中的 `/yorz-spec` 指令前缀与类型参数），据此创建 spec。'
      : '本次需求见下方用户输入（忽略其中的 `/yorz-spec` 指令前缀与 spec 路径参数）；若该内容已作为 `[open]` 条目写入 `## 追加任务`，按追加任务流程消费。'
    : specPath
      ? '本次没有额外输入，按 spec 现状继续推进。'
      : '请先根据对话上下文确认本次要处理的 spec 或需求；若上下文不足，请向用户补齐后再推进。'

  return wrapHiddenPrompt([...head, '', tail].join('\n'), original)
}

/**
 * Attachments uploaded while composing live in a draft directory; the agent
 * moves them next to the spec it is about to create. Empty when there are none.
 */
function buildDraftAttachmentGuide(specsDirRelative: string, draftId?: string): string[] {
  if (!draftId) return []
  return [
    '',
    `附件迁移：本次新建 spec 关联了草稿附件目录 \`.yorz/tmp/drafts/${draftId}/attachments/\`。`,
    `- 在创建 \`${specsDirRelative}/<id>/\` 目录并写入 \`spec.md\` 骨架**之后**，立即把该 draft 目录下的所有文件迁移到 \`${specsDirRelative}/<id>/attachments/\`，文件名保持不变。`,
    '- 迁移完成后，在 `## 背景` 章节末尾追加一段附件列表，每个附件占一行（按文件扩展名判定 `kind`）：',
    '  - 图片（`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.bmp` / `.svg` / `.avif` / `.heic`）：使用 `![<文件名>](attachments/<文件名>)`',
    '  - PDF（`.pdf`） / 文本（`.txt` / `.md` / `.markdown`）：使用 `[<文件名>](attachments/<文件名>)`',
    '- 迁移失败（如 draft 目录已被清理、权限不足）时，**不要静默丢弃**：在 `## 待确认项` 章节追加一条记录说明问题，并退出本轮等待用户介入。',
  ]
}

export interface SpecDispatch {
  /** The one-line command; also what the Chat bubble and session title show. */
  commandLine: string
  /** Expanded prompt for the Agent — never starts with a slash. */
  prompt: string
}

/**
 * Single source of truth for every spec-side dispatch (append / run / worktree
 * conflict). Callers decide only *which* built-in applies; the command line and
 * its expansion are built here so all triggers stay byte-identical.
 */
export function buildSpecDispatch(opts: {
  specsDirRelative: string
  specId: string
  /** `true` routes to `yorz-debug`: a `fix` append, or an active `debug.md`. */
  debug: boolean
  /** Append description, if any. `run` and conflict dispatches have none. */
  body?: string
  /** Running command services; only meaningful for debug dispatches. */
  runtimeContext?: string
}): SpecDispatch {
  const specPath = `${opts.specsDirRelative}/${opts.specId}/spec.md`
  const commandLine = formatBuiltinCommand(
    opts.debug ? 'yorz-debug' : 'yorz-spec',
    specPath,
    opts.body,
  )
  const prompt = opts.debug
    ? buildDebugPrompt(commandLine, { runtimeContext: opts.runtimeContext })
    : buildSpecPrompt(commandLine, opts.specsDirRelative)
  return { commandLine, prompt }
}

/**
 * Dispatch for a spec that does not exist yet (the NewSpec page). The type the
 * user picked rides the command line as a `<type>:` prefix, so the bubble reads
 * exactly like the `/yorz-spec feat: …` a user could have typed in chat.
 */
export function buildDraftDispatch(opts: {
  specsDirRelative: string
  type: BuiltinSpecType
  requirement: string
  /** Draft attachments to migrate into the new spec directory, if any. */
  draftId?: string
}): SpecDispatch {
  const commandLine = formatTypedBuiltinCommand('yorz-spec', opts.type, opts.requirement)
  const prompt = buildSpecPrompt(commandLine, opts.specsDirRelative, { draftId: opts.draftId })
  return { commandLine, prompt }
}

/**
 * Last resort for a slash prefix that matched no built-in and no configured
 * instruction — including a configured one whose hidden prompt is empty, which
 * `applyCustomInstruction` returns untouched.
 *
 * Tells the Agent the prefix is YorZ syntax rather than stripping it: stripping
 * would make the transcript diverge from the optimistic bubble.
 */
function buildUnknownCommandPrompt(prompt: string, hit: GlobalCustomInstruction | null): string {
  const original = prompt.trim()
  const lines = [
    '下方用户输入以 `/` 开头，这是 YorZ 输入框的指令语法，**不是**你自身的 slash command，请勿按命令解析、也不要回复 `Unknown command`。',
  ]
  if (hit) {
    lines.push(
      `\`/${hit.name}\` 是用户在 YorZ 中配置的自定义指令，但未配置隐藏提示词${
        hit.description ? `；其说明为：${hit.description}` : ''
      }。请结合该指令名与下方正文理解用户意图。`,
    )
  } else {
    lines.push('该指令未在 YorZ 中配置，请忽略指令前缀，按普通文本理解下方正文。')
  }
  return wrapHiddenPrompt(lines.join('\n'), original)
}

/**
 * Single entry point for chat prompt expansion: built-ins first, then the
 * user's configured instructions, then the unknown-command fallback.
 */
export function resolveChatPrompt(
  prompt: string,
  instructions: readonly GlobalCustomInstruction[],
  opts: { specsDirRelative?: string; now?: Date; runtimeContext?: string } = {},
): ResolvedChatPrompt {
  const original = prompt.trim()
  if (!isSlashCommand(original)) return { prompt, builtin: null }

  if (isYorzDebugCommand(original)) {
    return {
      prompt: buildDebugPrompt(original, { now: opts.now, runtimeContext: opts.runtimeContext }),
      builtin: 'yorz-debug',
    }
  }
  if (SPEC_COMMAND_RE.test(original)) {
    return {
      prompt: buildSpecPrompt(original, opts.specsDirRelative ?? '.yorz/specs'),
      builtin: 'yorz-spec',
    }
  }

  const hit = matchCustomInstruction(original, instructions)
  if (hit?.hiddenPrompt.trim()) {
    return { prompt: wrapHiddenPrompt(hit.hiddenPrompt, original), builtin: null }
  }
  return { prompt: buildUnknownCommandPrompt(original, hit), builtin: null }
}
