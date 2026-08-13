import { describe, expect, it } from 'vitest'
import type { GlobalCustomInstruction } from '../global-config.js'
import {
  appendHiddenPrompt,
  applyCustomInstruction,
  matchCustomInstruction,
  stripHiddenPrompt,
  wrapHiddenPrompt,
} from '../custom-instruction.js'

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

describe('matchCustomInstruction', () => {
  const list = [instruction()]

  it('matches a bare command', () => {
    expect(matchCustomInstruction('/git-commit', list)?.name).toBe('git-commit')
  })

  it('matches a command followed by extra text', () => {
    expect(matchCustomInstruction('/git-commit only src', list)?.name).toBe('git-commit')
  })

  it('does not match a longer name sharing the prefix', () => {
    expect(matchCustomInstruction('/git-commit-all', list)).toBeNull()
  })

  it('ignores prompts that are not commands', () => {
    expect(matchCustomInstruction('commit please', list)).toBeNull()
  })
})

describe('wrapHiddenPrompt / stripHiddenPrompt', () => {
  it('round-trips back to the original input', () => {
    const original = '/git-commit only src'
    const wrapped = wrapHiddenPrompt('hidden text', original)
    expect(wrapped).toContain('hidden text')
    expect(stripHiddenPrompt(wrapped)).toBe(original)
  })

  it('round-trips an appended block', () => {
    const original = 'look at this'
    expect(stripHiddenPrompt(appendHiddenPrompt(original, '- file.png'))).toBe(original)
  })

  it('strips several blocks at once', () => {
    const text = appendHiddenPrompt(wrapHiddenPrompt('a', 'visible'), 'b')
    expect(stripHiddenPrompt(text)).toBe('visible')
  })

  it('is a no-op without markers', () => {
    expect(stripHiddenPrompt('plain text')).toBe('plain text')
  })

  it('treats an empty hidden prompt as a no-op', () => {
    expect(wrapHiddenPrompt('   ', 'visible')).toBe('visible')
    expect(appendHiddenPrompt('visible', '')).toBe('visible')
  })
})

describe('applyCustomInstruction', () => {
  it('injects the hidden prompt while keeping the user text verbatim', () => {
    const prompt = '/git-commit only src'
    const out = applyCustomInstruction(prompt, [instruction()])
    expect(out).toContain('使用 git 提交当前会话相关的变更文件')
    expect(stripHiddenPrompt(out)).toBe(prompt)
  })

  it('leaves the prompt untouched when nothing matches', () => {
    expect(applyCustomInstruction('/unknown', [instruction()])).toBe('/unknown')
  })

  it('leaves the prompt untouched when the hidden prompt is empty', () => {
    const list = [instruction({ hiddenPrompt: '' })]
    expect(applyCustomInstruction('/git-commit', list)).toBe('/git-commit')
  })
})
