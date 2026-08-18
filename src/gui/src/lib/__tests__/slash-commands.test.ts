import { describe, expect, it } from 'vitest'
import type { CustomInstruction } from '../api.js'
import { buildSlashReplacement, mergeScopedInstructions } from '../slash-commands.js'

function instruction(over: Partial<CustomInstruction> = {}): CustomInstruction {
  return {
    id: 'i-1',
    name: 'deploy',
    description: '',
    hiddenPrompt: '',
    prefill: '',
    createdAt: 1,
    ...over,
  }
}

describe('buildSlashReplacement', () => {
  it('falls back to the bare command when there is no prefill', () => {
    expect(buildSlashReplacement('deploy', '')).toBe('/deploy ')
    expect(buildSlashReplacement('deploy', '   ')).toBe('/deploy ')
  })

  it('keeps the command name in front of the prefill', () => {
    expect(buildSlashReplacement('deploy', '只发布 web')).toBe('/deploy 只发布 web')
  })

  it('preserves a trailing space in the prefill', () => {
    expect(buildSlashReplacement('deploy', 'only web ')).toBe('/deploy only web ')
  })

  it('does not duplicate a prefix the prefill already carries', () => {
    expect(buildSlashReplacement('deploy', '/deploy only web')).toBe('/deploy only web')
    expect(buildSlashReplacement('deploy', '/deploy ')).toBe('/deploy ')
  })

  it('treats a longer command name as a different command', () => {
    expect(buildSlashReplacement('deploy', '/deploy-all now')).toBe('/deploy /deploy-all now')
  })
})

describe('mergeScopedInstructions', () => {
  it('tags each entry with its scope, project first', () => {
    const merged = mergeScopedInstructions(
      [instruction({ id: 'p-1', name: 'deploy' })],
      [instruction({ id: 'g-1', name: 'review' })],
    )
    expect(merged.map((item) => [item.name, item.scope])).toEqual([
      ['deploy', 'project'],
      ['review', 'global'],
    ])
  })

  it('shadows a global command with the project one of the same name', () => {
    const merged = mergeScopedInstructions(
      [instruction({ id: 'p-1', hiddenPrompt: 'project' })],
      [instruction({ id: 'g-1', hiddenPrompt: 'global' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 'p-1', scope: 'project' })
  })

  it('handles an empty project scope', () => {
    const merged = mergeScopedInstructions([], [instruction()])
    expect(merged.map((item) => item.scope)).toEqual(['global'])
  })
})
