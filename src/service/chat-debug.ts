import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBuiltinCommand, specDirOf, SPEC_PATH_ANCHOR_NOTE } from './builtin-command.js'
import { skillRef } from './skill-ref.js'
import { wrapHiddenPrompt } from './custom-instruction.js'

export const CHAT_DEBUG_DIR_REL = '.yorz/tmp/debug'
export const CHAT_DEBUG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const CHAT_DEBUG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export function isYorzDebugCommand(prompt: string): boolean {
  return /^\/yorz-debug(?:\s|$)/.test(prompt.trim())
}

export interface DebugPromptOptions {
  /** Only used by the spec-less chat variant, which stamps a temp file name. */
  now?: Date
  /** Running command services, injected verbatim so the agent can reproduce. */
  runtimeContext?: string
}

/**
 * Expand `/yorz-debug [<spec path>] <body>` into full instructions, wrapped so
 * the GUI can strip them back off. The command line stays outside the marker
 * block and doubles as the bug description, which keeps the rendered bubble
 * identical to what was typed (or, for spec-side dispatches, to the one-line
 * command YorZ synthesised).
 *
 * With a spec path the debug doc lives next to `spec.md`; without one this is a
 * standalone chat debug and it goes to a temp file instead.
 */
export function buildDebugPrompt(prompt: string, opts: DebugPromptOptions = {}): string {
  const parsed = parseBuiltinCommand(prompt)
  const original = prompt.trim()
  const body = parsed?.body ?? ''
  const specPath = parsed?.specPath ?? ''
  const runtimeContext = opts.runtimeContext?.trim() ? `\n${opts.runtimeContext.trim()}` : ''

  const head = specPath
    ? [
        `${skillRef('yorz-debug')}，然后进入 Debug 模式：spec 目录 \`${specDirOf(specPath)}\`（含 \`${specPath}\`）。`,
        `Debug 活文档为 \`${specDirOf(specPath)}/debug.md\`：不存在则创建；已存在则按 skill 的「重入」规则处理` +
          `——frontmatter \`status: debugging\` 时定位 \`active\` 指向的 \`## Debug NNN\` 记录块续跑、勿新建，否则在文末追加新的记录块。`,
        `新建记录块时立即 \`git stash create\` 打快照写入 Debug 基线；续跑已有记录块则沿用其中已记录的基线。`,
        SPEC_PATH_ANCHOR_NOTE,
      ]
    : [
        `${skillRef('yorz-debug')}，然后进入 Debug 模式。`,
        `本次是普通 chat 独立触发，没有 spec_dir。Debug 活文档必须写入临时文件 \`${CHAT_DEBUG_DIR_REL}/debug-${formatDebugTimestamp(opts.now ?? new Date())}.md\`。`,
        `写入前请确保目录 \`${CHAT_DEBUG_DIR_REL}/\` 存在；该目录属于临时目录，会由 YorZ 定时清理。`,
        `如果该文件不存在则创建；本文件只承载本次 chat debug 记录，不需要追加复用其他文件。`,
      ]

  const tail = body
    ? '待调试问题见下方用户输入（忽略其中的 `/yorz-debug` 指令前缀与 spec 路径参数）：'
    : specPath
      ? '请结合该 spec 的 `## 追加任务` 与对话上下文确认本次待调试问题；若信息不足，请向用户补齐复现信息。'
      : '请先根据对话上下文确认待调试问题；若上下文不足，请向用户补齐复现信息。'

  // Runtime context sits *before* the tail line: that line points at "下方用户输入",
  // which lives outside the hidden block, so nothing may come between them.
  return wrapHiddenPrompt([...head, runtimeContext, '', tail].filter(Boolean).join('\n'), original)
}

export async function cleanupExpiredChatDebugFiles(
  projectPath: string,
  opts: { now?: number; ttlMs?: number } = {},
): Promise<{ removed: string[] }> {
  const root = join(projectPath, CHAT_DEBUG_DIR_REL)
  if (!existsSync(root)) return { removed: [] }
  const removed: string[] = []
  const cutoff = (opts.now ?? Date.now()) - (opts.ttlMs ?? CHAT_DEBUG_RETENTION_MS)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { removed }
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = join(root, entry.name)
    try {
      const s = await stat(file)
      if (s.mtimeMs <= cutoff) {
        await rm(file, { force: true })
        removed.push(entry.name)
      }
    } catch {
      // best-effort
    }
  }
  return { removed }
}

export function scheduleChatDebugCleanup(projectPath: string): () => void {
  void mkdir(join(projectPath, CHAT_DEBUG_DIR_REL), { recursive: true })
    .then(() => cleanupExpiredChatDebugFiles(projectPath))
    .catch(() => {})

  const timer = setInterval(() => {
    void cleanupExpiredChatDebugFiles(projectPath).catch(() => {})
  }, CHAT_DEBUG_CLEANUP_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

function formatDebugTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}
