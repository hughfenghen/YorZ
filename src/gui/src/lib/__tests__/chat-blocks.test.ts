import { describe, expect, it } from 'vitest'
import {
  groupParts,
  toPart,
  type AssistantBlock,
  type ChatPart,
  type ToolPart,
} from '../chat-blocks.js'

const userText = (text: string): ChatPart => ({ kind: 'text', role: 'user', text })
const botText = (text: string): ChatPart => ({ kind: 'text', role: 'assistant', text })
const use = (name: string, input: unknown = {}): ChatPart => ({ kind: 'tool', name, input })
const result = (text: string): ChatPart => ({ kind: 'tool', result: text })

const assistantAt = (blocks: ReturnType<typeof groupParts>, i: number): AssistantBlock => {
  const b = blocks[i]
  if (!b || b.kind !== 'assistant') throw new Error(`block ${i} is not an assistant block`)
  return b
}

const toolsOf = (block: AssistantBlock, i: number): ToolPart[] => {
  const seg = block.segments[i]
  if (!seg || seg.kind !== 'tools') throw new Error(`segment ${i} is not a tools segment`)
  return seg.tools
}

describe('toPart', () => {
  it('keeps the role on text parts', () => {
    expect(toPart('assistant', { type: 'text', text: 'hi' })).toEqual({
      kind: 'text',
      role: 'assistant',
      text: 'hi',
    })
  })

  it('drops the role on tool-use and keeps name/input', () => {
    expect(
      toPart('assistant', { type: 'tool-use', name: 'Read', input: { file: 'a.ts' } }),
    ).toEqual({ kind: 'tool', name: 'Read', input: { file: 'a.ts' } })
  })

  it('drops the protocol-level user role on tool-result', () => {
    // The wire format reports tool-result under role:'user'; it must not survive.
    expect(toPart('user', { type: 'tool-result', text: 'ok' })).toEqual({
      kind: 'tool',
      result: 'ok',
    })
  })
})

describe('groupParts bubble boundaries', () => {
  it('starts a new bubble on a user text part', () => {
    const blocks = groupParts([userText('q1'), botText('a1'), userText('q2'), botText('a2')])
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  it('merges consecutive assistant text parts into one text segment', () => {
    const blocks = groupParts([botText('Hello'), botText(' '), botText('world')])
    expect(blocks).toHaveLength(1)
    const block = assistantAt(blocks, 0)
    expect(block.segments).toEqual([{ kind: 'text', text: 'Hello world' }])
  })

  it('does NOT split the bubble on tool parts — they join the current assistant bubble', () => {
    const blocks = groupParts([
      userText('go'),
      botText('working'),
      use('Read'),
      result('file body'),
      botText('done'),
    ])
    // The whole agent turn is a single bubble, despite the tool round-trip.
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'assistant'])
    const block = assistantAt(blocks, 1)
    expect(block.segments.map((s) => s.kind)).toEqual(['text', 'tools', 'text'])
  })

  it('opens an assistant bubble for a tool part with no preceding assistant text', () => {
    const blocks = groupParts([userText('go'), use('Bash')])
    expect(blocks.map((b) => b.kind)).toEqual(['user', 'assistant'])
    expect(toolsOf(assistantAt(blocks, 1), 0)).toHaveLength(1)
  })
})

describe('groupParts tool segments', () => {
  it('merges consecutive tool parts into a single tools segment', () => {
    const blocks = groupParts([use('Read'), result('r1'), use('Bash'), result('r2'), use('Edit')])
    const block = assistantAt(blocks, 0)
    expect(block.segments).toHaveLength(1)
    expect(toolsOf(block, 0)).toHaveLength(3)
  })

  it('pairs a tool-result onto the last un-answered tool-use', () => {
    const blocks = groupParts([use('Read', { file: 'a.ts' }), result('contents')])
    const tools = toolsOf(assistantAt(blocks, 0), 0)
    expect(tools).toEqual([
      { kind: 'tool', name: 'Read', input: { file: 'a.ts' }, result: 'contents' },
    ])
  })

  it('pairs results to uses even when the uses are batched before the results', () => {
    const blocks = groupParts([use('Read'), use('Bash'), result('r-bash'), result('r-read')])
    const tools = toolsOf(assistantAt(blocks, 0), 0)
    // Each result fills the most recent still-unanswered use (LIFO).
    expect(tools.map((t) => [t.name, t.result])).toEqual([
      ['Read', 'r-read'],
      ['Bash', 'r-bash'],
    ])
  })

  it('keeps an orphan result as its own item', () => {
    const blocks = groupParts([result('orphan')])
    const tools = toolsOf(assistantAt(blocks, 0), 0)
    expect(tools).toEqual([{ kind: 'tool', result: 'orphan' }])
  })

  it('splits tool segments when assistant text comes between them', () => {
    const blocks = groupParts([use('Read'), botText('thinking'), use('Edit')])
    const block = assistantAt(blocks, 0)
    expect(block.segments.map((s) => s.kind)).toEqual(['tools', 'text', 'tools'])
  })
})

describe('groupParts regressions', () => {
  it('never produces an empty bubble from a tool-result-only message', () => {
    // The old model mapped a role:'user' + [tool-result] message to text:'' —
    // an empty user bubble that also cut the agent's output in half.
    const parts = [
      toPart('assistant', { type: 'text', text: 'a1' }),
      toPart('assistant', { type: 'tool-use', name: 'Read', input: {} }),
      toPart('user', { type: 'tool-result', text: 'r' }),
      toPart('assistant', { type: 'text', text: 'a2' }),
    ]
    const blocks = groupParts(parts)
    expect(blocks.map((b) => b.kind)).toEqual(['assistant'])
    const block = assistantAt(blocks, 0)
    expect(block.segments.map((s) => s.kind)).toEqual(['text', 'tools', 'text'])
  })

  it('returns no blocks for an empty stream', () => {
    expect(groupParts([])).toEqual([])
  })

  it('keeps an empty user text as a bubble but drops an empty assistant turn', () => {
    expect(groupParts([userText('')])).toEqual([{ kind: 'user', text: '' }])
  })
})
