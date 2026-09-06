import { describe, expect, it } from 'vitest'
import type { ChatPart } from '@shared/lib/chat-blocks.js'
import {
  createTranscriptCache,
  samePartTail,
  transcriptCacheKey,
  TRANSCRIPT_CACHE_CAPACITY,
} from '@shared/lib/transcript-cache.js'

function text(t: string, role: 'user' | 'assistant' = 'assistant'): ChatPart {
  return { kind: 'text', role, text: t }
}

function entry(...parts: ChatPart[]) {
  return { parts }
}

describe('transcriptCacheKey', () => {
  it('separates the project from the session with a character neither can hold', () => {
    expect(transcriptCacheKey('proj', 'sid')).toBe('proj\u0000sid')
  })

  it('keeps two sessions of different projects apart', () => {
    expect(transcriptCacheKey('a', 'b')).not.toBe(transcriptCacheKey('b', 'a'))
  })
})

describe('createTranscriptCache', () => {
  it('returns what was stored, scope included', () => {
    const cache = createTranscriptCache(3)
    cache.set('k', { specId: 'spec-1', parts: [text('hi')] })
    expect(cache.get('k')).toEqual({ specId: 'spec-1', parts: [text('hi')] })
    expect(cache.get('missing')).toBeUndefined()
  })

  it('keeps only one copy per key and reports its size', () => {
    const cache = createTranscriptCache(3)
    cache.set('k', entry(text('one')))
    cache.set('k', entry(text('two')))
    expect(cache.size).toBe(1)
    expect(cache.get('k')?.parts).toEqual([text('two')])
  })

  it('evicts the least recently used entry once over capacity', () => {
    const cache = createTranscriptCache(2)
    cache.set('a', entry(text('a')))
    cache.set('b', entry(text('b')))
    cache.set('c', entry(text('c')))
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
  })

  it('a read counts as use, so the untouched entry is the one dropped', () => {
    const cache = createTranscriptCache(2)
    cache.set('a', entry(text('a')))
    cache.set('b', entry(text('b')))
    cache.get('a')
    cache.set('c', entry(text('c')))
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
  })

  it('a re-set also counts as use', () => {
    const cache = createTranscriptCache(2)
    cache.set('a', entry(text('a')))
    cache.set('b', entry(text('b')))
    cache.set('a', entry(text('a2')))
    cache.set('c', entry(text('c')))
    expect(cache.get('a')?.parts).toEqual([text('a2')])
    expect(cache.get('b')).toBeUndefined()
  })

  it('holds the documented number of sessions by default', () => {
    const cache = createTranscriptCache()
    for (let i = 0; i < TRANSCRIPT_CACHE_CAPACITY + 1; i += 1) {
      cache.set(`k${i}`, entry(text(`m${i}`)))
    }
    expect(TRANSCRIPT_CACHE_CAPACITY).toBe(20)
    expect(cache.size).toBe(TRANSCRIPT_CACHE_CAPACITY)
    expect(cache.get('k0')).toBeUndefined()
    expect(cache.get('k20')).toBeDefined()
  })

  it('never degenerates to a zero-capacity cache', () => {
    const cache = createTranscriptCache(0)
    cache.set('a', entry(text('a')))
    expect(cache.get('a')).toBeDefined()
  })

  it('clear drops everything', () => {
    const cache = createTranscriptCache(3)
    cache.set('a', entry(text('a')))
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })
})

describe('samePartTail', () => {
  it('treats two empty streams as unchanged', () => {
    expect(samePartTail([], [])).toBe(true)
  })

  it('rejects a stream that grew', () => {
    expect(samePartTail([text('a')], [text('a'), text('b')])).toBe(false)
  })

  it('accepts an identical tail at equal length', () => {
    expect(samePartTail([text('a'), text('b')], [text('a'), text('b')])).toBe(true)
  })

  it('catches the cached copy that caught the last message mid-stream', () => {
    expect(samePartTail([text('a'), text('par')], [text('a'), text('partial')])).toBe(false)
  })

  it('separates the two roles of a text part', () => {
    expect(samePartTail([text('a', 'user')], [text('a', 'assistant')])).toBe(false)
  })

  it('rejects a tail of a different kind', () => {
    expect(samePartTail([text('a')], [{ kind: 'tool', name: 'Read' }])).toBe(false)
  })

  it('compares a tool part by name and result', () => {
    const call: ChatPart = { kind: 'tool', name: 'Read', input: { path: 'a' } }
    expect(samePartTail([call], [{ kind: 'tool', name: 'Read', input: { path: 'a' } }])).toBe(true)
    expect(samePartTail([call], [{ kind: 'tool', name: 'Write', input: { path: 'a' } }])).toBe(
      false,
    )
    expect(samePartTail([{ kind: 'tool', result: 'ok' }], [{ kind: 'tool', result: 'no' }])).toBe(
      false,
    )
  })

  it('ignores a tool input, which is delivered whole and never grows', () => {
    expect(
      samePartTail(
        [{ kind: 'tool', name: 'Write', input: { body: 'x' } }],
        [{ kind: 'tool', name: 'Write', input: { body: 'y' } }],
      ),
    ).toBe(true)
  })

  it('compares a context part by kind and text', () => {
    const a: ChatPart = { kind: 'context', contextKind: 'agents_instructions', text: 'a' }
    expect(samePartTail([a], [{ ...a }])).toBe(true)
    expect(samePartTail([a], [{ ...a, text: 'b' }])).toBe(false)
    expect(samePartTail([a], [{ ...a, contextKind: 'environment_context' }])).toBe(false)
  })

  it('compares a divider by the session it opens', () => {
    const a: ChatPart = {
      kind: 'divider',
      sessionId: 's1',
      agentKind: 'claude',
      startedAt: 1,
    }
    expect(samePartTail([a], [{ ...a }])).toBe(true)
    expect(samePartTail([a], [{ ...a, sessionId: 's2' }])).toBe(false)
    expect(samePartTail([a], [{ ...a, startedAt: 2 }])).toBe(false)
  })
})
