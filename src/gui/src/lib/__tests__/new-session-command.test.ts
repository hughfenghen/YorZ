import { describe, expect, it } from 'vitest'
import { parseNewSessionCommand } from '@shared/lib/new-session-command.js'

describe('parseNewSessionCommand', () => {
  it('matches the bare builtin command', () => {
    expect(parseNewSessionCommand('/new')).toEqual({ content: '' })
    expect(parseNewSessionCommand('  /new  ')).toEqual({ content: '' })
  })

  it('returns the text that should become the new session first message', () => {
    expect(parseNewSessionCommand('/new inspect this')).toEqual({ content: 'inspect this' })
    expect(parseNewSessionCommand('/new\nline one\nline two')).toEqual({
      content: 'line one\nline two',
    })
  })

  it('does not consume lookalikes or commands outside the first token', () => {
    expect(parseNewSessionCommand('/newer')).toBeNull()
    expect(parseNewSessionCommand('please /new')).toBeNull()
    expect(parseNewSessionCommand('/NEW')).toBeNull()
  })
})
