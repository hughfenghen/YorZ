import { describe, expect, it } from 'vitest'
import {
  appendChunk,
  capText,
  emptyOutputState,
  stateFromSlice,
  type CommandOutputState,
} from '../command-output.js'

const bytes = (s: string) => new TextEncoder().encode(s).length

describe('stateFromSlice', () => {
  it('positions nextOffset at the end of the returned slice', () => {
    const state = stateFromSlice({ offset: 100, text: 'hello', size: 105, truncated: true })
    expect(state).toEqual({ text: 'hello', nextOffset: 105, truncated: true })
  })

  it('accounts for multi-byte characters when computing nextOffset', () => {
    const text = '构建完成'
    const state = stateFromSlice({ offset: 0, text, size: bytes(text), truncated: false })
    expect(state.nextOffset).toBe(bytes(text))
    expect(state.nextOffset).not.toBe(text.length)
  })
})

describe('appendChunk', () => {
  it('appends a contiguous chunk', () => {
    const a = stateFromSlice({ offset: 0, text: 'ab', size: 2, truncated: false })
    const r = appendChunk(a, { offset: 2, chunk: 'cd' })
    expect(r.needsRefetch).toBe(false)
    expect(r.state.text).toBe('abcd')
    expect(r.state.nextOffset).toBe(4)
  })

  it('appends several contiguous chunks in order', () => {
    let state = emptyOutputState()
    for (const [offset, chunk] of [
      [0, 'one\n'],
      [4, 'two\n'],
      [8, 'three\n'],
    ] as Array<[number, string]>) {
      const r = appendChunk(state, { offset, chunk })
      expect(r.needsRefetch).toBe(false)
      state = r.state
    }
    expect(state.text).toBe('one\ntwo\nthree\n')
    expect(state.nextOffset).toBe(14)
  })

  it('flags a refetch when a chunk starts past the expected offset', () => {
    const a = stateFromSlice({ offset: 0, text: 'ab', size: 2, truncated: false })
    const r = appendChunk(a, { offset: 10, chunk: 'zz' })
    expect(r.needsRefetch).toBe(true)
    expect(r.state).toBe(a) // unchanged
  })

  it('silently drops a fully re-delivered chunk instead of refetching', () => {
    const a = stateFromSlice({ offset: 0, text: 'abcd', size: 4, truncated: false })
    const r = appendChunk(a, { offset: 0, chunk: 'ab' })
    expect(r.needsRefetch).toBe(false)
    expect(r.state.text).toBe('abcd')
    expect(r.state.nextOffset).toBe(4)
  })

  it('refetches on a partially overlapping chunk it cannot splice', () => {
    const a = stateFromSlice({ offset: 0, text: 'abcd', size: 4, truncated: false })
    const r = appendChunk(a, { offset: 2, chunk: 'cdef' })
    expect(r.needsRefetch).toBe(true)
  })

  it('tracks byte offsets for multi-byte chunks', () => {
    let state: CommandOutputState = emptyOutputState()
    const first = '编译中…\n'
    const second = '完成\n'
    state = appendChunk(state, { offset: 0, chunk: first }).state
    const r = appendChunk(state, { offset: bytes(first), chunk: second })
    expect(r.needsRefetch).toBe(false)
    expect(r.state.text).toBe(first + second)
    expect(r.state.nextOffset).toBe(bytes(first) + bytes(second))
  })

  it('recovers by rebuilding from a fresh slice after a gap', () => {
    const a = stateFromSlice({ offset: 0, text: 'ab', size: 2, truncated: false })
    expect(appendChunk(a, { offset: 99, chunk: 'x' }).needsRefetch).toBe(true)
    const resynced = stateFromSlice({ offset: 90, text: 'tail', size: 94, truncated: true })
    expect(appendChunk(resynced, { offset: 94, chunk: '!' }).state.text).toBe('tail!')
  })
})

describe('capText', () => {
  it('keeps the tail and marks the state truncated', () => {
    const state = stateFromSlice({ offset: 0, text: 'abcdefghij', size: 10, truncated: false })
    const capped = capText(state, 4)
    expect(capped.text).toBe('ghij')
    expect(capped.truncated).toBe(true)
    expect(capped.nextOffset).toBe(10) // offset tracking is unaffected
  })

  it('is a no-op below the cap', () => {
    const state = stateFromSlice({ offset: 0, text: 'abc', size: 3, truncated: false })
    expect(capText(state, 10)).toBe(state)
  })
})
