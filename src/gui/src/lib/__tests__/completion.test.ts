import { describe, expect, it } from 'vitest'
import {
  applyCompletion,
  detectTrigger,
  filterSlashCommands,
  replacementFor,
  type SlashCommand,
} from '@shared/lib/completion.js'

describe('detectTrigger', () => {
  it('reads a leading slash as a command, only at offset 0', () => {
    expect(detectTrigger('/dep', 4, true)).toEqual({ kind: 'slash', query: 'dep' })
    expect(detectTrigger('/', 1, true)).toEqual({ kind: 'slash', query: '' })
  })

  it('ignores a slash that is not at the start', () => {
    // `src/lib` is a path, not a command — the slash branch must not claim it.
    expect(detectTrigger('src/lib', 7, true)).toBeNull()
    expect(detectTrigger('hi /dep', 7, true)).toBeNull()
  })

  it('stops treating it as a command once a space is typed', () => {
    expect(detectTrigger('/dep now', 8, true)).toBeNull()
  })

  it('falls through to mention when slash is disabled', () => {
    expect(detectTrigger('/dep', 4, false)).toBeNull()
    expect(detectTrigger('@src/a', 6, false)).toEqual({ kind: 'mention', start: 0, query: 'src/a' })
  })

  it('anchors a mention at the last @ and allows path characters', () => {
    expect(detectTrigger('see @src/lib/a.ts', 17, true)).toEqual({
      kind: 'mention',
      start: 4,
      query: 'src/lib/a.ts',
    })
    expect(detectTrigger('@a @b', 5, true)).toEqual({ kind: 'mention', start: 3, query: 'b' })
  })

  it('closes the mention once a character outside the path alphabet appears', () => {
    expect(detectTrigger('@src lib', 8, true)).toBeNull()
  })

  it('classifies by caret position, not by full text', () => {
    // Caret sits right after `@sr`; the trailing text must not widen the query.
    expect(detectTrigger('@src/a.ts tail', 3, true)).toEqual({
      kind: 'mention',
      start: 0,
      query: 'sr',
    })
  })
})

describe('applyCompletion', () => {
  it('replaces the mention span and keeps trailing text', () => {
    expect(
      applyCompletion('see @sr tail', { kind: 'mention', start: 4, query: 'sr' }, '@src/a.ts'),
    ).toEqual({ next: 'see @src/a.ts tail', cursorPos: 13 })
  })

  it('replaces the slash span from offset 0', () => {
    expect(applyCompletion('/dep', { kind: 'slash', query: 'dep' }, '/deploy ')).toEqual({
      next: '/deploy ',
      cursorPos: 8,
    })
  })

  it('strips the query when the replacement is empty', () => {
    expect(applyCompletion('/add', { kind: 'slash', query: 'add' }, '')).toEqual({
      next: '',
      cursorPos: 0,
    })
  })
})

describe('replacementFor', () => {
  it('prefixes a mention with @', () => {
    expect(replacementFor({ kind: 'mention', value: 'src/a.ts' })).toBe('@src/a.ts')
  })

  it('defaults a command to its value plus a trailing space', () => {
    const command: SlashCommand = { value: '/yorz-spec' }
    expect(
      replacementFor({ kind: 'slash', value: '/yorz-spec', label: '/yorz-spec', command }),
    ).toBe('/yorz-spec ')
  })

  it('honours an explicit replacement', () => {
    const command: SlashCommand = { value: '/deploy' }
    expect(
      replacementFor({
        kind: 'slash',
        value: '/deploy',
        label: '/deploy',
        replacement: '/deploy only web',
        command,
      }),
    ).toBe('/deploy only web')
  })
})

describe('filterSlashCommands', () => {
  const commands: SlashCommand[] = [
    { value: '/yorz-debug' },
    { value: '/yorz-spec' },
    { value: '/deploy' },
  ]

  it('returns everything for an empty query', () => {
    expect(filterSlashCommands(commands, '')).toHaveLength(3)
  })

  it('ranks a prefix hit above a scattered one', () => {
    expect(filterSlashCommands(commands, 'dep')[0]?.value).toBe('/deploy')
  })

  it('drops commands that do not match at all', () => {
    expect(filterSlashCommands(commands, 'zzz')).toEqual([])
  })

  it('matches on label when value does not', () => {
    const withLabel: SlashCommand[] = [{ value: '/add-command', label: 'New command' }]
    expect(filterSlashCommands(withLabel, 'new')).toHaveLength(1)
  })
})
