import { describe, expect, it } from 'vitest'
import { TOOL_TEXT_PREVIEW_LIMIT, toolTextView } from '../chat-tool-text.js'

const text = (n: number, char = 'x'): string => char.repeat(n)

describe('toolTextView', () => {
  it('leaves a short payload whole and unmarked', () => {
    const view = toolTextView('short result')
    expect(view).toEqual({ truncated: false, preview: 'short result', length: 12 })
  })

  it('treats a payload of exactly the limit as fitting', () => {
    // Boundary matters: an off-by-one here puts a "show all 300 chars" button
    // under text that is already fully visible.
    const view = toolTextView(text(TOOL_TEXT_PREVIEW_LIMIT))
    expect(view.truncated).toBe(false)
    expect(view.preview).toHaveLength(TOOL_TEXT_PREVIEW_LIMIT)
  })

  it('truncates one character past the limit', () => {
    const view = toolTextView(text(TOOL_TEXT_PREVIEW_LIMIT + 1))
    expect(view.truncated).toBe(true)
    expect(view.preview).toHaveLength(TOOL_TEXT_PREVIEW_LIMIT)
    expect(view.length).toBe(TOOL_TEXT_PREVIEW_LIMIT + 1)
  })

  it('previews the head, not the tail', () => {
    // Opposite of command-output's capText: a tool result's opening lines are
    // what the reader is after, not its last ones.
    const view = toolTextView(`${text(10, 'A')}${text(500, 'B')}`)
    expect(view.preview.startsWith('AAAAAAAAAA')).toBe(true)
    expect(view.preview.includes('BBB')).toBe(true)
    expect(view.preview.endsWith('A')).toBe(false)
  })

  it('reports the full length so the expand affordance can price the click', () => {
    expect(toolTextView(text(4096)).length).toBe(4096)
  })

  it('handles an empty payload', () => {
    expect(toolTextView('')).toEqual({ truncated: false, preview: '', length: 0 })
  })

  it('honours a caller-supplied limit', () => {
    const view = toolTextView('abcdef', 3)
    expect(view).toEqual({ truncated: true, preview: 'abc', length: 6 })
  })
})
