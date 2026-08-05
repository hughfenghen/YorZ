import { describe, expect, it } from 'vitest'
import { skillEntryPath, skillRef } from '../skill-ref.js'

describe('skill-ref', () => {
  it('skillEntryPath resolves an absolute SKILL.md path in the shared dir', () => {
    expect(skillEntryPath('yorz-spec', { YORZ_HOME: '/tmp/yorz-home' })).toBe(
      '/tmp/yorz-home/skills/yorz-spec/SKILL.md',
    )
  })

  it('skillRef embeds the absolute path and the skill name', () => {
    const ref = skillRef('yorz-debug', { YORZ_HOME: '/tmp/yorz-home' })
    expect(ref).toContain('/tmp/yorz-home/skills/yorz-debug/SKILL.md')
    expect(ref).toContain('yorz-debug')
    expect(ref).toContain('请先完整阅读并严格遵循')
  })

  it('honors XDG_CONFIG_HOME when YORZ_HOME is absent', () => {
    expect(skillEntryPath('yorz-spec', { XDG_CONFIG_HOME: '/tmp/xdg' })).toBe(
      '/tmp/xdg/yorz/skills/yorz-spec/SKILL.md',
    )
  })

  it('falls back to an absolute default path with no env overrides', () => {
    const p = skillEntryPath('yorz-spec', {})
    expect(p.startsWith('/')).toBe(true)
    expect(p.endsWith('/yorz/skills/yorz-spec/SKILL.md')).toBe(true)
  })
})
