import { describe, expect, it } from 'vitest'
import {
  formatBuiltinCommand,
  formatTypedBuiltinCommand,
  parseBuiltinCommand,
  specDirOf,
} from '../builtin-command.js'

describe('parseBuiltinCommand', () => {
  it('returns null for text that does not open with a command', () => {
    expect(parseBuiltinCommand('加个夜间模式')).toBeNull()
    expect(parseBuiltinCommand('see src/a.ts')).toBeNull()
  })

  it('reads an optional spec path positional argument', () => {
    expect(parseBuiltinCommand('/yorz-spec .yorz/specs/x/spec.md 继续')).toEqual({
      name: 'yorz-spec',
      specPath: '.yorz/specs/x/spec.md',
      specType: '',
      body: '继续',
    })
    expect(parseBuiltinCommand('/yorz-spec 加个夜间模式')).toEqual({
      name: 'yorz-spec',
      specPath: '',
      specType: '',
      body: '加个夜间模式',
    })
  })

  it('strips the @ file-reference marker off the spec path', () => {
    // What the composer's @-autocomplete inserts, and what YorZ now synthesises.
    expect(parseBuiltinCommand('/yorz-spec @.yorz/specs/x/spec.md 继续')).toEqual({
      name: 'yorz-spec',
      specPath: '.yorz/specs/x/spec.md',
      specType: '',
      body: '继续',
    })
    // Regression: with the @ left in, specDirOf() aimed debug.md at "@.yorz/specs/x".
    expect(specDirOf(parseBuiltinCommand('/yorz-debug @.yorz/specs/x/spec.md 崩溃')!.specPath)).toBe(
      '.yorz/specs/x',
    )
  })

  it('splits a <type>: body prefix, with either colon', () => {
    expect(parseBuiltinCommand('/yorz-spec feat: 加个夜间模式')).toMatchObject({
      specType: 'feat',
      body: '加个夜间模式',
    })
    // The requirement next to it is usually typed with a Chinese IME.
    expect(parseBuiltinCommand('/yorz-spec fix：登录报错')).toMatchObject({
      specType: 'fix',
      body: '登录报错',
    })
    expect(parseBuiltinCommand('/yorz-spec refct:重构 store')).toMatchObject({
      specType: 'refct',
      body: '重构 store',
    })
  })

  it('leaves an unknown prefix in the body', () => {
    expect(parseBuiltinCommand('/yorz-spec chore: 清理依赖')).toMatchObject({
      specType: '',
      body: 'chore: 清理依赖',
    })
  })

  it('keeps the body verbatim when a spec path was named', () => {
    // With a path the type is owned by the document; an append description may
    // legitimately open with "fix: …".
    expect(parseBuiltinCommand('/yorz-spec .yorz/specs/x/spec.md fix: 顺带修一下')).toEqual({
      name: 'yorz-spec',
      specPath: '.yorz/specs/x/spec.md',
      specType: '',
      body: 'fix: 顺带修一下',
    })
  })

  it('handles a bare command and a multi-line body', () => {
    expect(parseBuiltinCommand('/yorz-debug')).toEqual({
      name: 'yorz-debug',
      specPath: '',
      specType: '',
      body: '',
    })
    expect(parseBuiltinCommand('/yorz-spec feat: 第一行\n第二行')).toMatchObject({
      specType: 'feat',
      body: '第一行\n第二行',
    })
  })
})

describe('formatBuiltinCommand', () => {
  it('marks the spec path with @ and round-trips with the parser', () => {
    const line = formatBuiltinCommand('yorz-spec', '.yorz/specs/x/spec.md', '继续')
    expect(line).toBe('/yorz-spec @.yorz/specs/x/spec.md 继续')
    expect(parseBuiltinCommand(line)).toMatchObject({ specPath: '.yorz/specs/x/spec.md' })
  })

  it('does not double the @ when the caller already prefixed the path', () => {
    expect(formatBuiltinCommand('yorz-debug', '@.yorz/specs/x/spec.md')).toBe(
      '/yorz-debug @.yorz/specs/x/spec.md',
    )
  })

  it('renders a typed command and round-trips with the parser', () => {
    const line = formatTypedBuiltinCommand('yorz-spec', 'refct', '拆分 store')
    expect(line).toBe('/yorz-spec refct: 拆分 store')
    expect(parseBuiltinCommand(line)).toMatchObject({ specType: 'refct', body: '拆分 store' })
  })
})

describe('specDirOf', () => {
  it('drops the file segment, falling back to the project root', () => {
    expect(specDirOf('.yorz/specs/x/spec.md')).toBe('.yorz/specs/x')
    expect(specDirOf('spec.md')).toBe('.')
  })
})
