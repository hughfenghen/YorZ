import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { skillRef } from './skill-ref.js'
import { wrapHiddenPrompt } from './custom-instruction.js'

export const CHAT_DEBUG_DIR_REL = '.yorz/tmp/debug'
export const CHAT_DEBUG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const CHAT_DEBUG_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export function isYorzDebugCommand(prompt: string): boolean {
  return /^\/yorz-debug(?:\s|$)/.test(prompt.trim())
}

/**
 * Expand `/yorz-debug` into full instructions, wrapped so the GUI can strip
 * them back off. The user's original line stays outside the marker block and
 * doubles as the bug description, which keeps the rendered bubble identical to
 * what was typed.
 */
export function buildChatDebugPrompt(prompt: string, now = new Date()): string {
  const original = prompt.trim()
  const body = original.replace(/^\/yorz-debug(?:\s+|$)/, '').trim()
  const debugPath = `${CHAT_DEBUG_DIR_REL}/debug-${formatDebugTimestamp(now)}.md`
  const guide = [
    `${skillRef('yorz-debug')}，然后进入 Debug 模式。`,
    `本次是普通 chat 独立触发，没有 spec_dir。Debug 活文档必须写入临时文件 \`${debugPath}\`。`,
    `写入前请确保目录 \`${CHAT_DEBUG_DIR_REL}/\` 存在；该目录属于临时目录，会由 YorZ 定时清理。`,
    `如果该文件不存在则创建；本文件只承载本次 chat debug 记录，不需要追加复用其他文件。`,
    '',
    body
      ? '待调试问题见下方用户输入（忽略其中的 `/yorz-debug` 指令前缀）：'
      : '请先根据对话上下文确认待调试问题；若上下文不足，请向用户补齐复现信息。',
  ].join('\n')
  return wrapHiddenPrompt(guide, original)
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
