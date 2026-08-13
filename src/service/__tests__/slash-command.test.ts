import { describe, expect, it } from 'vitest'
import { stripHiddenPrompt } from '../custom-instruction.js'
import type { GlobalCustomInstruction } from '../global-config.js'
import { buildChatSpecPrompt, isSlashCommand, resolveChatPrompt } from '../slash-command.js'

function instruction(over: Partial<GlobalCustomInstruction> = {}): GlobalCustomInstruction {
  return {
    id: 'id-1',
    name: 'git-commit',
    description: '',
    hiddenPrompt: '使用 git 提交当前会话相关的变更文件',
    prefill: '',
    createdAt: 1,
    ...over,
  }
}

const list = [instruction()]

describe('isSlashCommand', () => {
  it('accepts a bare or argument-carrying command', () => {
    expect(isSlashCommand('/yorz-spec')).toBe(true)
    expect(isSlashCommand('/yorz-spec 修一个 bug')).toBe(true)
  })

  it('rejects plain text and mid-sentence slashes', () => {
    expect(isSlashCommand('hello')).toBe(false)
    expect(isSlashCommand('see src/service/foo.ts')).toBe(false)
    expect(isSlashCommand('/')).toBe(false)
  })
})

describe('resolveChatPrompt', () => {
  // The whole point of the module: nothing reaches the Agent CLI looking like
  // one of its own slash commands.
  const cases: Array<[string, string]> = [
    ['built-in debug', '/yorz-debug 页面白屏'],
    ['built-in spec', '/yorz-spec 加个夜间模式'],
    ['configured instruction', '/git-commit only src'],
    ['configured instruction without a hidden prompt', '/no-hidden'],
    ['unknown command', '/definitely-not-a-command 帮我看看'],
  ]
  const instructions = [...list, instruction({ id: 'id-2', name: 'no-hidden', hiddenPrompt: '' })]

  it.each(cases)('never emits a leading slash: %s', (_label, prompt) => {
    const out = resolveChatPrompt(prompt, instructions)
    expect(out.prompt.startsWith('/')).toBe(false)
  })

  it.each(cases)('keeps the user text recoverable: %s', (_label, prompt) => {
    const out = resolveChatPrompt(prompt, instructions)
    expect(stripHiddenPrompt(out.prompt)).toBe(prompt)
  })

  it('reports which built-in matched', () => {
    expect(resolveChatPrompt('/yorz-debug x', list).builtin).toBe('yorz-debug')
    expect(resolveChatPrompt('/yorz-spec x', list).builtin).toBe('yorz-spec')
    expect(resolveChatPrompt('/git-commit', list).builtin).toBeNull()
    expect(resolveChatPrompt('/unknown', list).builtin).toBeNull()
  })

  it('injects the configured hidden prompt', () => {
    const out = resolveChatPrompt('/git-commit only src', list)
    expect(out.prompt).toContain('使用 git 提交当前会话相关的变更文件')
  })

  it('tells the Agent an unknown prefix is YorZ syntax', () => {
    const out = resolveChatPrompt('/definitely-not-a-command', list)
    expect(out.prompt).toContain('YorZ 输入框的指令语法')
    expect(out.prompt).toContain('该指令未在 YorZ 中配置')
  })

  it('names the instruction when it matched but carries no hidden prompt', () => {
    const instructions = [instruction({ hiddenPrompt: '', description: '提交变更文件' })]
    const out = resolveChatPrompt('/git-commit', instructions)
    expect(out.prompt).toContain('/git-commit')
    expect(out.prompt).toContain('提交变更文件')
  })

  it('leaves non-command prompts completely untouched', () => {
    expect(resolveChatPrompt('  正常提问  ', list)).toEqual({
      prompt: '  正常提问  ',
      builtin: null,
    })
  })
})

describe('buildChatSpecPrompt', () => {
  it('references the skill and the project spec dir', () => {
    const out = buildChatSpecPrompt('/yorz-spec 加个夜间模式', 'docs/specs')
    expect(out).toContain('yorz-spec')
    expect(out).toContain('docs/specs/')
    expect(stripHiddenPrompt(out)).toBe('/yorz-spec 加个夜间模式')
  })

  it('asks the Agent to recover intent from context when no body was given', () => {
    const out = buildChatSpecPrompt('/yorz-spec', '.yorz/specs')
    expect(out).toContain('请先根据对话上下文确认')
  })
})
