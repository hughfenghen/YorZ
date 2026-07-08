import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { getAdapter } from '../index.js'

const HOME = '/tmp/test-home'
const CWD = '/tmp/test-cwd'

describe('claude adapter', () => {
  const a = getAdapter('claude')

  it('resolves user scope to ~/.claude/skills', () => {
    expect(a.resolveSkillsDir('user', { home: HOME, cwd: CWD })).toBe(
      join(HOME, '.claude', 'skills'),
    )
  })

  it('resolves project scope to <cwd>/.claude/skills', () => {
    expect(a.resolveSkillsDir('project', { home: HOME, cwd: CWD })).toBe(
      join(CWD, '.claude', 'skills'),
    )
  })
})

describe('opencode adapter', () => {
  const a = getAdapter('opencode')

  it('resolves user scope to ~/.config/opencode/skills', () => {
    expect(a.resolveSkillsDir('user', { home: HOME, cwd: CWD })).toBe(
      join(HOME, '.config', 'opencode', 'skills'),
    )
  })

  it('resolves project scope to <cwd>/.opencode/skills', () => {
    expect(a.resolveSkillsDir('project', { home: HOME, cwd: CWD })).toBe(
      join(CWD, '.opencode', 'skills'),
    )
  })
})

describe('codex adapter', () => {
  const a = getAdapter('codex')

  it('resolves user scope to ~/.codex/skills', () => {
    expect(a.resolveSkillsDir('user', { home: HOME, cwd: CWD })).toBe(
      join(HOME, '.codex', 'skills'),
    )
  })

  it('resolves project scope to <cwd>/.codex/skills', () => {
    expect(a.resolveSkillsDir('project', { home: HOME, cwd: CWD })).toBe(
      join(CWD, '.codex', 'skills'),
    )
  })
})

describe('getAdapter', () => {
  it('throws on unknown agent', () => {
    expect(() => getAdapter('cursor')).toThrow(/Unknown agent/)
  })
})
