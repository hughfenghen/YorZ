import { mkdir, mkdtemp, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildChatDebugPrompt,
  cleanupExpiredChatDebugFiles,
  isYorzDebugCommand,
} from '../chat-debug.js'

describe('chat debug prompt', () => {
  it('wraps /yorz-debug into a temp debug file path with timestamp', () => {
    const prompt = buildChatDebugPrompt(
      '/yorz-debug 修复 chat debug 写入根目录的问题',
      new Date(2026, 7, 3, 9, 8, 7),
    )

    expect(prompt).toContain('.yorz/tmp/debug/debug-20260803-090807.md')
    expect(prompt).toContain('Debug 活文档必须写入临时文件')
    expect(prompt).toContain('该目录属于临时目录，会由 YorZ 定时清理')
    expect(prompt).toContain('修复 chat debug 写入根目录的问题')
  })

  it('only treats the slash command as debug mode', () => {
    expect(isYorzDebugCommand('/yorz-debug')).toBe(true)
    expect(isYorzDebugCommand('/yorz-debug fix')).toBe(true)
    expect(isYorzDebugCommand('please /yorz-debug fix')).toBe(false)
    expect(isYorzDebugCommand('/yorz-debugger')).toBe(false)
  })
})

describe('chat debug cleanup', () => {
  it('removes expired markdown files from .yorz/tmp/debug', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-chat-debug-'))
    const dir = join(cwd, '.yorz/tmp/debug')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'debug-old.md'), 'old', 'utf8')
    await writeFile(join(dir, 'debug-fresh.md'), 'fresh', 'utf8')
    await writeFile(join(dir, 'keep.txt'), 'keep', 'utf8')

    const now = Date.UTC(2026, 7, 3, 0, 0, 0)
    const old = new Date(now - 10_000)
    const fresh = new Date(now)
    await utimes(join(dir, 'debug-old.md'), old, old)
    await utimes(join(dir, 'debug-fresh.md'), fresh, fresh)
    await utimes(join(dir, 'keep.txt'), old, old)

    const out = await cleanupExpiredChatDebugFiles(cwd, { now, ttlMs: 1_000 })

    expect(out.removed).toEqual(['debug-old.md'])
    await expect(stat(join(dir, 'debug-old.md'))).rejects.toThrow()
    await expect(stat(join(dir, 'debug-fresh.md'))).resolves.toBeTruthy()
    await expect(stat(join(dir, 'keep.txt'))).resolves.toBeTruthy()
  })
})
