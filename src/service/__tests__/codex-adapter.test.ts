import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodexAdapter, summarizeCodexPromptForTitle } from '../agent-sdk/codex-adapter.js'

describe('summarizeCodexPromptForTitle', () => {
  it('cleans markdown and attachment noise into a readable short title', () => {
    const title = summarizeCodexPromptForTitle(`
      请修复 @src/gui/src/components/ChatPanel.tsx 的会话列表标题

      ---
      本次消息附带 1 个附件，已保存在临时目录 \`.yorz/tmp/drafts/a/attachments\`：
      - [trace.log](.yorz/tmp/drafts/a/attachments/trace.log)
    `)

    expect(title).toBe('请修复 src/gui/src/components/ChatPanel.tsx 的会话列表标题')
  })
})

describe('CodexAdapter.listSessions', () => {
  it('uses the first real user prompt when Codex session_index has no thread_name', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'yorz-codex-store-'))
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-codex-cwd-'))
    const sessionDir = join(storageRoot, 'sessions', '2026', '07', '25')
    const id = '019f9858-1fa6-7550-b514-7de5300c3a0b'
    await mkdir(sessionDir, { recursive: true })
    await writeFile(
      join(sessionDir, `rollout-2026-07-25T16-15-39-${id}.jsonl`),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id, cwd, timestamp: '2026-07-25T08:15:39.000Z' },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: '<recommended_plugins>\nnoise\n</recommended_plugins>',
              },
              {
                type: 'input_text',
                text: '# AGENTS.md instructions for /tmp/x\n<INSTRUCTIONS>\nnoise\n</INSTRUCTIONS>',
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'hello' }],
          },
        }),
      ].join('\n'),
    )

    const list = await new CodexAdapter(cwd, storageRoot).listSessions()

    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('hello')
  })

  it('prefers Codex session_index thread_name over prompt-derived titles', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'yorz-codex-store-'))
    const cwd = await mkdtemp(join(tmpdir(), 'yorz-codex-cwd-'))
    const sessionDir = join(storageRoot, 'sessions', '2026', '07', '25')
    const id = '019f3fa0-8adf-7cb1-8ab7-0ec84c3f98a4'
    await mkdir(sessionDir, { recursive: true })
    await writeFile(
      join(storageRoot, 'session_index.jsonl'),
      `${JSON.stringify({
        id,
        thread_name: 'Use Codex resume title',
        updated_at: '2026-07-25T07:46:47.000Z',
      })}\n`,
    )
    await writeFile(
      join(sessionDir, `rollout-2026-07-25T15-46-47-${id}.jsonl`),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id, cwd, timestamp: '2026-07-25T07:46:47.000Z' },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Fallback prompt title' }],
          },
        }),
      ].join('\n'),
    )

    const list = await new CodexAdapter(cwd, storageRoot).listSessions()

    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('Use Codex resume title')
  })
})
