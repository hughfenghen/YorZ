import { buildChatDebugPrompt, isYorzDebugCommand } from './chat-debug.js'
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

/**
 * Expand `/yorz-spec` into skill guidance, mirroring {@link buildChatDebugPrompt}:
 * the guidance goes in a hidden block and the user's line stays outside it.
 *
 * Chat has no spec selected, so the skill's own auto-mode decides between
 * resuming a spec already in the conversation and creating a new one.
 */
export function buildChatSpecPrompt(prompt: string, specsDirRelative: string): string {
  const original = prompt.trim()
  const body = original.replace(SPEC_COMMAND_RE, '').trim()
  const guide = [
    `${skillRef('yorz-spec')}，然后按其自动模式判定推进。`,
    `本次是普通 chat 独立触发，未指定 spec_path：若当前会话上下文中已出现过 spec 文档，继续推进该 spec；否则按 skill 的「新建 spec」流程创建后立即推进 plan 阶段。`,
    `spec 目录为 \`${specsDirRelative}/\`。`,
    '',
    body
      ? '本次需求见下方用户输入（忽略其中的 `/yorz-spec` 指令前缀）：'
      : '请先根据对话上下文确认本次要处理的 spec 或需求；若上下文不足，请向用户补齐后再推进。',
  ].join('\n')
  return wrapHiddenPrompt(guide, original)
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
  opts: { specsDirRelative?: string; now?: Date } = {},
): ResolvedChatPrompt {
  const original = prompt.trim()
  if (!isSlashCommand(original)) return { prompt, builtin: null }

  if (isYorzDebugCommand(original)) {
    return { prompt: buildChatDebugPrompt(original, opts.now), builtin: 'yorz-debug' }
  }
  if (SPEC_COMMAND_RE.test(original)) {
    return {
      prompt: buildChatSpecPrompt(original, opts.specsDirRelative ?? '.yorz/specs'),
      builtin: 'yorz-spec',
    }
  }

  const hit = matchCustomInstruction(original, instructions)
  if (hit?.hiddenPrompt.trim()) {
    return { prompt: wrapHiddenPrompt(hit.hiddenPrompt, original), builtin: null }
  }
  return { prompt: buildUnknownCommandPrompt(original, hit), builtin: null }
}
