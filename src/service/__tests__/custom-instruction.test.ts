import { describe, expect, it } from 'vitest'
import type { GlobalCustomInstruction } from '../global-config.js'
import {
  appendHiddenPrompt,
  applyCustomInstruction,
  matchCustomInstruction,
  mergeCustomInstructions,
  normalizeCustomInstructions,
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

describe('mergeCustomInstructions', () => {
  it('keeps project entries first and appends the global-only ones', () => {
    const project = [instruction({ id: 'p-1', name: 'deploy' })]
    const global = [instruction({ id: 'g-1', name: 'review' })]
    expect(mergeCustomInstructions(project, global).map((item) => item.name)).toEqual([
      'deploy',
      'review',
    ])
  })

  it('lets the project scope shadow a global command with the same name', () => {
    const project = [instruction({ id: 'p-1', hiddenPrompt: 'project prompt' })]
    const global = [instruction({ id: 'g-1', hiddenPrompt: 'global prompt' })]
    const merged = mergeCustomInstructions(project, global)
    expect(merged).toHaveLength(1)
    expect(merged[0].hiddenPrompt).toBe('project prompt')
    expect(matchCustomInstruction('/git-commit', merged)?.id).toBe('p-1')
  })

  it('returns the global list untouched when the project scope is empty', () => {
    const global = [instruction()]
    expect(mergeCustomInstructions([], global)).toEqual(global)
  })
})

describe('normalizeCustomInstructions', () => {
  it('drops malformed entries and strips the leading slash from names', () => {
    const out = normalizeCustomInstructions([
      { id: 'a', name: '/deploy', createdAt: 3 },
      { id: 'a', name: 'dup-id' },
      { id: '', name: 'no-id' },
      { id: 'b', name: 'bad name' },
      'not-an-object',
    ])
    expect(out.map((item) => item.name)).toEqual(['deploy'])
    expect(out[0]).toMatchObject({ description: '', hiddenPrompt: '', prefill: '', createdAt: 3 })
  })

  it('falls back to the pre-rename systemPrompt key', () => {
    const out = normalizeCustomInstructions([{ id: 'a', name: 'deploy', systemPrompt: 'legacy' }])
    expect(out[0].hiddenPrompt).toBe('legacy')
  })

  it('returns an empty list for non-array input', () => {
    expect(normalizeCustomInstructions(undefined)).toEqual([])
  })
})
