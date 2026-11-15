import { describe, expect, it } from 'vitest'
import { OpenCodeV2Adapter } from '../agent-sdk/opencode-v2-adapter.js'

/**
 * 针对真实 opencode v2 服务端的冒烟测试。
 *
 * 需要本机装有 v2 CLI（可选依赖 `@opencode/cli`，或 OpenCode 桌面版），并且会
 * 真的调一次模型，因此默认跳过；用 `OPENCODE_V2_LIVE=1 pnpm test` 打开。
 */
const live = process.env.OPENCODE_V2_LIVE === '1'

describe('OpenCodeV2Adapter live smoke', () => {
  it.skipIf(!live)(
    'drives a real opencode v2 server',
    async () => {
      const adapter = new OpenCodeV2Adapter(process.cwd())
      const catalog = await adapter.listModels()
      expect(catalog.models.length).toBeGreaterThan(0)

      const session = await adapter.createSession({ title: 'YorZ v2 适配器冒烟测试' })

      const deltas: string[] = []
      let completed = false
      for await (const event of session.send('Reply with exactly: PONG')) {
        if (event.type === 'text') deltas.push(event.delta)
        if (event.type === 'turn-completed') completed = true
        if (event.type === 'error') throw new Error(event.message)
      }

      expect(completed).toBe(true)
      expect(deltas.join('')).toContain('PONG')

      const messages = await adapter.getMessages(session.id)
      expect(messages.some((m) => m.role === 'assistant')).toBe(true)

      await adapter.dispose()
    },
    180_000,
  )

  /**
   * 一轮 turn 由**多个 step**组成（每次 LLM 调用一步，工具结果回填后再开下一步），
   * 只有 `session.execution.succeeded` 才是整轮结束。这条用例守住「不要在第一个
   * step 结束时就把 turn 判完」——否则服务层会立刻把会话置为结束并推送通知，
   * 而任务其实还在跑。
   */
  it.skipIf(!live)(
    'keeps a multi-step turn open until the whole execution finishes',
    async () => {
      const adapter = new OpenCodeV2Adapter(process.cwd())
      const session = await adapter.createSession({ title: 'YorZ v2 多步 turn 回归' })

      const toolUses: Array<{ name: string; input: unknown }> = []
      const toolResults: string[] = []
      const texts: string[] = []
      let completed = false
      for await (const event of session.send(
        'Use the bash tool to run `echo STEP-ONE`. Then use the bash tool again to run `echo STEP-TWO`. Finally reply with the two outputs on separate lines.',
      )) {
        if (event.type === 'tool-use') {
          expect(completed).toBe(false)
          toolUses.push({ name: event.name, input: event.input })
        }
        if (event.type === 'tool-result') {
          expect(completed).toBe(false)
          toolResults.push(event.text)
        }
        if (event.type === 'text') texts.push(event.delta)
        if (event.type === 'turn-completed') completed = true
        if (event.type === 'error') throw new Error(event.message)
      }

      expect(completed).toBe(true)
      // 流里已经收到的工具名/参数必须是真的，而不是兜底值。
      expect(toolUses.every((use) => use.name !== 'tool')).toBe(true)
      // 收尾时服务端存储里已经出现的 assistant 分片，必须都已经流过——旧实现会在
      // 第一个 step 之后就断流，这里能立刻看到缺口。
      const messages = await adapter.getMessages(session.id)
      const transcript = messages.filter((m) => m.role === 'assistant').flatMap((m) => m.parts)
      expect(toolUses).toHaveLength(transcript.filter((part) => part.type === 'tool-use').length)
      const transcriptText = transcript
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
      if (transcriptText) expect(texts.join('')).toContain(transcriptText)

      await adapter.dispose()
    },
    300_000,
  )
})
